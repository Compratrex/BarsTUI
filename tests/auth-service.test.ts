import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/features/auth/auth-service.js';
import { SecureAuthStore } from '../src/infrastructure/auth/auth-store.js';
import type { AuthStore, SavedAuth, SessionState } from '../src/features/auth/storage.js';
import { accountKey, AuthFlowError, type AuthGateway } from '../src/features/auth/contracts.js';
import type { LoginResult, SessionRestoreResult } from '../src/domain/models.js';

const session = (account: string): SessionState => ({
  cookies: [],
  origins: [
    { origin: 'https://example.test', localStorage: [{ name: 'account', value: account }] },
  ],
});
const record = (account: string): SavedAuth => ({
  account: accountKey(account),
  credentials: { account, password: `${account}-password` },
  session: session(account),
});
class Store implements AuthStore {
  constructor(public value: SavedAuth | null) {}
  async load() {
    return structuredClone(this.value);
  }
  async save(value: SavedAuth) {
    this.value = structuredClone(value);
  }
  async clear() {
    this.value = null;
    return true;
  }
}
class Gateway implements AuthGateway {
  account = 'alice';
  logins: string[] = [];
  checks = 0;
  async login(account: string): Promise<LoginResult> {
    this.account = account;
    this.logins.push(account);
    return { status: 'authenticated', profile: { account: `public\\${account}`, roles: [] } };
  }
  async verifyTwoFactor(): Promise<LoginResult> {
    return { status: 'authenticated', profile: { account: `public\\${this.account}`, roles: [] } };
  }
  async restoreSession(_state?: SessionState): Promise<SessionRestoreResult> {
    this.checks++;
    return { status: 'expired' };
  }
  async captureSession() {
    return session(this.account);
  }
  async close() {}
}

test('failed persistence after switching accounts cannot trigger automatic login to the previous account', async () => {
  const store = new Store(record('alice'));
  const gateway = new Gateway();
  store.save = async () => {
    throw new Error('native secret details');
  };
  const auth = new AuthService(gateway, store);
  const result = await auth.login('bob', 'bob-password');
  assert.equal(result.status, 'authenticated');
  if (result.status === 'authenticated') {
    assert.match(result.warning!, /прежний вход/);
    assert.doesNotMatch(result.warning!, /native|secret/);
  }
  assert.deepEqual(store.value, record('alice'));
  await assert.rejects(
    auth.restore(),
    (error) => error instanceof AuthFlowError && error.screen === 'login',
  );
  assert.deepEqual(gateway.logins, ['bob']);
  assert.equal(gateway.checks, 0);
});

test('a failed atomic write retains the previous whole record, and mixed account credentials are rejected', async () => {
  let secret: string | undefined;
  let fail = false;
  const store = new SecureAuthStore(async () => ({
    getPassword: async () => secret,
    setPassword: async (value) => {
      if (fail) throw new Error('native secret');
      secret = value;
    },
    deleteCredential: async () => {
      secret = undefined;
      return true;
    },
  }));
  await store.save(record('alice'));
  fail = true;
  await assert.rejects(store.save(record('bob')), /Не удалось сохранить/);
  assert.deepEqual(await store.load(), record('alice'));
  await assert.rejects(
    store.save({ ...record('bob'), credentials: record('alice').credentials }),
    /разным аккаунтам/,
  );
  assert.deepEqual(await store.load(), record('alice'));
});

test('legacy migration pairs credentials only with the account verified from the session', async () => {
  for (const matching of [true, false]) {
    let secret: string | undefined;
    const removals: string[] = [];
    const store = new SecureAuthStore(
      async () => ({
        getPassword: async () => secret,
        setPassword: async (value) => {
          secret = value;
        },
        deleteCredential: async () => true,
      }),
      'test',
      {
        credentials: {
          load: async () => record(matching ? 'alice' : 'bob').credentials!,
          save: async () => {},
          clear: async () => {
            assert.ok(secret);
            removals.push('credentials');
            return true;
          },
        },
        sessions: {
          load: async () => session('alice'),
          save: async () => {},
          clear: async () => {
            assert.ok(secret);
            removals.push('session');
            return true;
          },
        },
      },
    );
    const gateway = new Gateway();
    gateway.restoreSession = async () => ({
      status: 'authenticated',
      profile: { account: 'PUBLIC\\Alice', roles: [] },
    });
    const auth = new AuthService(gateway, store, {
      unlock: async () => {
        assert.equal(secret, undefined);
        return { status: 'authenticated' };
      },
    });
    assert.equal((await auth.restore()).status, 'authenticated');
    const saved = await store.load();
    assert.equal(saved?.legacy, undefined);
    assert.equal(saved?.account, accountKey('alice'));
    assert.deepEqual(saved?.credentials, matching ? record('alice').credentials : undefined);
    assert.deepEqual(removals.sort(), ['credentials', 'session']);
    assert.deepEqual(gateway.logins, []);
  }
});

test('an expired legacy session never submits an unverified legacy password', async () => {
  const store = new Store({
    ...record('bob'),
    account: null,
    session: session('alice'),
    legacy: true,
  });
  const gateway = new Gateway();
  const auth = new AuthService(gateway, store);
  assert.deepEqual(await auth.restore(), { status: 'login' });
  assert.deepEqual(gateway.logins, []);
});

test('rejected Touch ID does not migrate or replace any saved data', async () => {
  const original = { ...record('alice'), legacy: true };
  const store = new Store(original);
  const gateway = new Gateway();
  gateway.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'public\\alice', roles: [] },
  });
  const auth = new AuthService(gateway, store, { unlock: async () => ({ status: 'cancelled' }) });
  await assert.rejects(
    auth.restore(),
    (error) => error instanceof AuthFlowError && error.unlockStatus === 'cancelled',
  );
  assert.deepEqual(store.value, original);
  assert.deepEqual(gateway.logins, []);
});

test('fresh session profile must match the persisted account before unlocking', async () => {
  const gateway = new Gateway();
  gateway.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'public\\bob', roles: [] },
  });
  const auth = new AuthService(gateway, new Store(record('alice')), {
    unlock: async () => {
      assert.fail('Do not unlock a mismatched record');
    },
  });
  await assert.rejects(
    auth.restore(),
    (error) => error instanceof AuthFlowError && error.screen === 'login',
  );
  assert.deepEqual(gateway.logins, []);
});

test('forgetting auth tries both legacy entries even if one deletion fails', async () => {
  const removed: string[] = [];
  const store = new SecureAuthStore(
    async () => ({
      getPassword: async () => undefined,
      setPassword: async () => {},
      deleteCredential: async () => {
        removed.push('auth');
        throw new Error('native secret');
      },
    }),
    'test',
    {
      credentials: {
        load: async () => null,
        save: async () => {},
        clear: async () => {
          removed.push('credentials');
          return true;
        },
      },
      sessions: {
        load: async () => null,
        save: async () => {},
        clear: async () => {
          removed.push('session');
          return true;
        },
      },
    },
  );
  await assert.rejects(store.clear(), /Не удалось удалить все/);
  assert.deepEqual(removed.sort(), ['auth', 'credentials', 'session']);
});

test('closing during a different account login never captures its cookies under the previous account', async () => {
  const gateway = new Gateway();
  const store = new Store(null);
  const auth = new AuthService(gateway, store);
  await auth.login('alice', 'alice-password');
  let finish!: (result: LoginResult) => void;
  gateway.login = () =>
    new Promise((resolve) => {
      gateway.account = 'bob';
      finish = resolve;
    });
  const pending = auth.login('bob', 'bob-password');
  const rejected = assert.rejects(pending, /Приложение закрыто/);
  await auth.close();
  finish({ status: 'authenticated', profile: { account: 'public\\bob', roles: [] } });
  await rejected;
  assert.deepEqual(store.value, record('alice'));
});

test('snapshot failure warns after confirmed login and prevents falling back to another account', async () => {
  const store = new Store(record('alice'));
  const gateway = new Gateway();
  gateway.captureSession = async () => {
    throw new Error('native private-cookie');
  };
  const auth = new AuthService(gateway, store);
  const result = await auth.login('bob', 'bob-password');
  assert.equal(result.status, 'authenticated');
  if (result.status === 'authenticated') {
    assert.match(result.warning!, /Новый вход не сохранён/);
    assert.doesNotMatch(result.warning!, /private-cookie/);
  }
  await assert.rejects(
    auth.restore(),
    (error) => error instanceof AuthFlowError && error.screen === 'login',
  );
  assert.deepEqual(store.value, record('alice'));
  assert.deepEqual(gateway.logins, ['bob']);
});

test('shared credentials are unavailable before unlock, during 2FA and after close', async () => {
  const gateway = new Gateway();
  const auth = new AuthService(gateway, new Store(record('alice')));
  const read = () => auth.withCredentials(async (value) => value.account);
  await assert.rejects(read(), /Для почты нужен пароль/);
  await auth.login('alice', 'alice-password');
  assert.equal(await read(), 'alice');
  gateway.login = async (account) => {
    gateway.account = account;
    return { status: 'two-factor', message: 'Код' };
  };
  await auth.login('bob', 'bob-password');
  await assert.rejects(read(), /Для почты нужен пароль/);
  await auth.verifyTwoFactor('1234');
  assert.equal(await read(), 'bob');
  await auth.close();
  await assert.rejects(read(), /закрыто/);
});

test('shared credentials come only from the account unlocked by Touch ID', async () => {
  const gateway = new Gateway();
  gateway.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'public\\alice', roles: [] },
  });
  let unlocked = false;
  const auth = new AuthService(gateway, new Store(record('alice')), {
    unlock: async () => {
      await assert.rejects(
        auth.withCredentials(async () => 'must not run'),
        /Для почты нужен пароль/,
      );
      return { status: unlocked ? 'authenticated' : 'cancelled' };
    },
  });
  await assert.rejects(auth.restore());
  await assert.rejects(
    auth.withCredentials(async () => 'must not run'),
    /Для почты нужен пароль/,
  );
  unlocked = true;
  await auth.restore();
  assert.equal(await auth.withCredentials(async (value) => value.account), 'alice');
  await auth.close();
});

test('group preference survives session restore, expiry and manual login only for the same account', async () => {
  const choice = { id: 'group-a', studentId: 'enrollment-a' };
  const store = new Store(null);
  const first = new AuthService(new Gateway(), store);
  await first.login('alice', 'alice-password');
  assert.equal(await first.rememberGroup(choice), undefined);
  await first.close();
  assert.deepEqual(store.value?.selectedGroup, choice);

  const gateway = new Gateway();
  gateway.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'PUBLIC\\Alice', roles: [] },
  });
  const restarted = new AuthService(gateway, store, {
    unlock: async () => {
      assert.equal(restarted.selectedGroup, undefined);
      return { status: 'authenticated' };
    },
  });
  await restarted.restore();
  assert.deepEqual(restarted.selectedGroup, choice);
  assert.deepEqual(gateway.logins, []);
  gateway.restoreSession = async () => ({ status: 'expired' });
  await restarted.restore();
  assert.deepEqual(restarted.selectedGroup, choice);
  await restarted.close();

  const manual = new AuthService(new Gateway(), store);
  await manual.login('alice', 'alice-password');
  assert.deepEqual(manual.selectedGroup, choice);
  await manual.login('bob', 'bob-password');
  assert.equal(manual.selectedGroup, undefined);
  assert.equal(store.value?.selectedGroup, undefined);
  await manual.close();
});

test('group preferences cannot be read or persisted before session unlock', async () => {
  const choice = { id: 'group-a', studentId: 'enrollment-a' };
  const original = { ...record('alice'), selectedGroup: choice };
  const store = new Store(original);
  const gateway = new Gateway();
  gateway.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'alice', roles: [] },
  });
  const auth = new AuthService(gateway, store, { unlock: async () => ({ status: 'cancelled' }) });
  await assert.rejects(auth.restore());
  assert.equal(auth.selectedGroup, undefined);
  assert.match((await auth.rememberGroup({ id: 'other', studentId: 'other' }))!, /на этот запуск/);
  assert.deepEqual(store.value, original);
  await auth.close();
});

test('secure auth record stores group identifiers and rejects malformed or unbound preferences', async () => {
  let secret: string | undefined;
  const store = new SecureAuthStore(async () => ({
    getPassword: async () => secret,
    setPassword: async (value) => {
      secret = value;
    },
    deleteCredential: async () => true,
  }));
  const value = { ...record('alice'), selectedGroup: { id: 'group-a', studentId: 'enrollment-a' } };
  await store.save(value);
  assert.deepEqual(await store.load(), value);
  await assert.rejects(store.save({ account: null, selectedGroup: value.selectedGroup }));
  for (const selectedGroup of [
    { id: '' },
    { id: 'a', studentId: 42 },
    { id: 'a', studentId: ' ' },
  ]) {
    secret = JSON.stringify({ version: 1, auth: { ...record('alice'), selectedGroup } });
    await assert.rejects(store.load(), /повреждён/);
  }
});
