import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WindowsDataProtector,
  WindowsProtectedEntry,
  type DataProtector,
} from '../src/infrastructure/auth/windows-secrets.js';
import { SecureCredentialStore } from '../src/infrastructure/auth/credentials.js';
import { SecureSessionStore } from '../src/infrastructure/auth/sessions.js';
import { type SessionState } from '../src/features/auth/storage.js';
import { SecureAuthStore } from '../src/infrastructure/auth/auth-store.js';
import { accountKey } from '../src/features/auth/contracts.js';

// Simulates an external OS cipher. This is deliberately not an application encryption scheme.
function fakeCipher(): DataProtector {
  const secrets = new Map<string, Buffer>();
  let next = 0;
  return {
    async transform(operation, data, purpose) {
      if (operation === 'protect') {
        const token = `opaque-${purpose}-${++next}`;
        secrets.set(token, Buffer.from(data));
        return Buffer.from(token);
      }
      const token = data.toString();
      if (!token.startsWith(`opaque-${purpose}-`) || !secrets.has(token))
        throw new Error('native private-secret');
      return Buffer.from(secrets.get(token)!);
    },
  };
}
const credentials = { account: 'логин с пробелами', password: '  \"\\\n$`🗝️ пароль  ' };
const session: SessionState = {
  cookies: [
    {
      name: 'session',
      value: 'private-cookie'.repeat(1000),
      domain: 'bars.mpei.ru',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: 'https://bars.mpei.ru',
      localStorage: [{ name: 'setting', value: 'значение'.repeat(1000) }],
    },
  ],
};

test('Windows stores reopen credentials and large sessions using ciphertext files only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bars-windows-'));
  const cipher = fakeCipher();
  const entry = (account: 'credentials-v1' | 'session-v1') =>
    new WindowsProtectedEntry(account, directory, cipher);
  const store = new SecureCredentialStore(async () => entry('credentials-v1'));
  const sessions = new SecureSessionStore(async () => entry('session-v1'));
  try {
    assert.equal(await store.load(), null);
    assert.equal(await sessions.load(), null);
    await store.save(credentials);
    await sessions.save(session);
    assert.deepEqual(
      await new SecureCredentialStore(async () => entry('credentials-v1')).load(),
      credentials,
    );
    assert.deepEqual(await new SecureSessionStore(async () => entry('session-v1')).load(), session);
    assert.deepEqual((await readdir(directory)).sort(), [
      'credentials-v1.dpapi',
      'session-v1.dpapi',
    ]);
    for (const name of await readdir(directory))
      assert.match(await readFile(join(directory, name), 'utf8'), /^opaque-/);
    await store.save({ account: 'new-user', password: 'new-password' });
    assert.deepEqual(await store.load(), { account: 'new-user', password: 'new-password' });
    assert.equal(await sessions.clear(), true);
    assert.equal(await sessions.clear(), false);
    assert.notEqual(await store.load(), null);
    assert.equal(await store.clear(), true);
    assert.equal(await store.load(), null);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows migrates the legacy files into one encrypted auth record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bars-windows-auth-'));
  const cipher = fakeCipher();
  const legacy = {
    credentials: new SecureCredentialStore(
      async () => new WindowsProtectedEntry('credentials-v1', directory, cipher),
    ),
    sessions: new SecureSessionStore(
      async () => new WindowsProtectedEntry('session-v1', directory, cipher),
    ),
  };
  const entry = async () => new WindowsProtectedEntry('auth-v1', directory, cipher);
  const store = new SecureAuthStore(entry, 'Windows', legacy);
  try {
    await legacy.credentials.save(credentials);
    await legacy.sessions.save(session);
    assert.equal((await store.load())?.legacy, true);
    const record = { account: accountKey(credentials.account), credentials, session };
    await store.save(record);
    assert.deepEqual(await new SecureAuthStore(entry).load(), record);
    assert.deepEqual(await readdir(directory), ['auth-v1.dpapi']);
    const encrypted = await readFile(join(directory, 'auth-v1.dpapi'), 'utf8');
    assert.match(encrypted, /^opaque-auth-v1-/);
    assert.equal(encrypted.includes(credentials.password), false);
    await store.clear();
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('encryption failure preserves the existing file and never writes a plaintext fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bars-windows-'));
  try {
    const file = join(directory, 'credentials-v1.dpapi');
    await writeFile(file, 'existing-ciphertext');
    for (const cipher of [
      {
        transform: async () => {
          throw new Error('native private-secret');
        },
      },
      { transform: async (_operation: unknown, plain: Buffer) => Buffer.from(plain) },
      { transform: async () => Buffer.alloc(0) },
    ]) {
      const entry = new WindowsProtectedEntry('credentials-v1', directory, cipher);
      await assert.rejects(entry.setPassword('private-secret'), {
        message: 'Не удалось сохранить защищённые данные Windows.',
      });
      assert.equal(await readFile(file, 'utf8'), 'existing-ciphertext');
      assert.deepEqual(await readdir(directory), ['credentials-v1.dpapi']);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('damaged or swapped Windows files fail without disclosing stored bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bars-windows-'));
  const cipher = fakeCipher();
  const entry = new WindowsProtectedEntry('credentials-v1', directory, cipher);
  try {
    const file = join(directory, 'credentials-v1.dpapi');
    await writeFile(file, 'plaintext-password-must-not-load');
    await assert.rejects(entry.getPassword(), {
      message: 'Не удалось прочитать защищённые данные Windows.',
    });
    const wrongPurpose = await cipher.transform(
      'protect',
      Buffer.from('private-secret'),
      'session-v1',
    );
    await writeFile(file, wrongPurpose);
    await assert.rejects(entry.getPassword(), {
      message: 'Не удалось прочитать защищённые данные Windows.',
    });
    assert.deepEqual(await readFile(file), wrongPurpose);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('DPAPI IPC preserves Unicode bytes and rejects unexpected output and native errors', async () => {
  const plain = Buffer.from(JSON.stringify(credentials));
  const encrypted = Buffer.from([0, 255, 1, 200]);
  const cipher = new WindowsDataProtector(async (input) => {
    const request = JSON.parse(input);
    assert.equal(request.purpose, 'credentials-v1');
    assert.equal(request.operation, 'protect');
    assert.deepEqual(Buffer.from(request.data, 'base64'), plain);
    return JSON.stringify({ version: 1, data: encrypted.toString('base64') });
  });
  assert.deepEqual(await cipher.transform('protect', plain, 'credentials-v1'), encrypted);
  for (const response of [
    '',
    'True',
    'null',
    '{}',
    '{"version":2,"data":"YQ=="}',
    ...['###', 'YQ', 'YQ===', 'YR==', 'YQ==\nUnexpected output'].map((data) =>
      JSON.stringify({ version: 1, data }),
    ),
  ]) {
    await assert.rejects(
      new WindowsDataProtector(async () => response).transform('protect', plain, 'credentials-v1'),
      /Не удалось выполнить шифрование/,
    );
  }
  await assert.rejects(
    new WindowsDataProtector(async () => {
      throw new Error(plain.toString());
    }).transform('unprotect', encrypted, 'credentials-v1'),
    { message: 'Не удалось выполнить шифрование или расшифровку данных Windows.' },
  );
});

test(
  'native Windows DPAPI roundtrip, update, tamper detection and purpose binding',
  { skip: process.platform !== 'win32' ? 'Requires Windows DPAPI' : false },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bars-native-dpapi-'));
    const cipher = new WindowsDataProtector();
    const store = new SecureCredentialStore(
      async () => new WindowsProtectedEntry('credentials-v1', directory, cipher),
    );
    const sessions = new SecureSessionStore(
      async () => new WindowsProtectedEntry('session-v1', directory, cipher),
    );
    const auth = new SecureAuthStore(
      async () => new WindowsProtectedEntry('auth-v1', directory, cipher),
    );
    try {
      await store.save(credentials);
      await sessions.save(session);
      const record = { account: accountKey(credentials.account), credentials, session };
      await auth.save(record);
      assert.deepEqual(await auth.load(), record);
      const bundle = await readFile(join(directory, 'auth-v1.dpapi'));
      assert.equal(bundle.includes(Buffer.from(credentials.password)), false);
      await assert.rejects(
        cipher.transform('unprotect', bundle, 'session-v1'),
        /Не удалось выполнить шифрование/,
      );
      assert.deepEqual(await store.load(), credentials);
      assert.deepEqual(await sessions.load(), session);
      await store.save({ account: 'changed-account', password: credentials.password });
      assert.equal((await store.load())?.account, 'changed-account');
      const saved = await readFile(join(directory, 'session-v1.dpapi'));
      assert.equal(saved.includes(Buffer.from('private-cookie')), false);
      assert.equal(saved.includes(Buffer.from('значение')), false);
      await assert.rejects(
        cipher.transform('unprotect', saved, 'credentials-v1'),
        /Не удалось выполнить шифрование/,
      );
      const damaged = Buffer.from(saved);
      damaged[damaged.length - 1] ^= 1;
      await assert.rejects(
        cipher.transform('unprotect', damaged, 'session-v1'),
        /Не удалось выполнить шифрование/,
      );
      assert.equal(await store.clear(), true);
      assert.equal(await sessions.clear(), true);
      assert.equal(await auth.clear(), true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
