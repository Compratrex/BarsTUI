import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureSessionStore } from '../src/infrastructure/auth/sessions.js';
import { type SessionState } from '../src/features/auth/storage.js';

const state: SessionState = {
  cookies: [
    {
      name: 'session',
      value: 'private-cookie',
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
      localStorage: [{ name: 'setting', value: 'private-local-value' }],
    },
  ],
};
class Entry {
  secret?: string;
  async getPassword() {
    return this.secret;
  }
  async setPassword(secret: string) {
    this.secret = secret;
  }
  async deleteCredential() {
    const existed = this.secret !== undefined;
    this.secret = undefined;
    return existed;
  }
}
test('session cookies and local storage survive reopening and can be forgotten', async () => {
  const entry = new Entry();
  const first = new SecureSessionStore(async () => entry);
  assert.equal(await first.load(), null);
  await first.save(state);
  const second = new SecureSessionStore(async () => entry);
  assert.deepEqual(await second.load(), state);
  assert.equal(await second.clear(), true);
  assert.equal(await first.load(), null);
  assert.equal(await first.clear(), false);
});
test('malformed session records do not expose tokens or overwrite the saved record', async () => {
  const entry = new Entry();
  const store = new SecureSessionStore(async () => entry);
  for (const secret of [
    'private-cookie',
    JSON.stringify({ version: 1, state: { cookies: [null], origins: [] } }),
    JSON.stringify({ version: 2, state }),
  ]) {
    entry.secret = secret;
    await assert.rejects(store.load(), {
      message: 'Сохранённая сессия повреждена. Можно войти заново через Esc.',
    });
    assert.equal(entry.secret, secret);
  }
});
test('native session errors never disclose cookie values', async () => {
  const fail = async (): Promise<never> => {
    throw new Error('native error: private-cookie');
  };
  const store = new SecureSessionStore(async () => ({
    getPassword: fail,
    setPassword: fail,
    deleteCredential: fail,
  }));
  await assert.rejects(store.load(), {
    message: 'Не удалось прочитать сессию из защищённого хранилища.',
  });
  await assert.rejects(store.save(state), {
    message: 'Не удалось сохранить сессию в защищённом хранилище.',
  });
  await assert.rejects(store.clear(), {
    message: 'Не удалось удалить сессию из защищённого хранилища.',
  });
});
