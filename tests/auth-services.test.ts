import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthServices } from '../src/infrastructure/auth/auth-services.js';
import {
  SECRET_SERVICE,
  type SecretAccount,
  type SecretEntry,
} from '../src/infrastructure/auth/secret-store.js';

test('Windows and macOS save one account-bound record; only macOS requires Touch ID', async () => {
  for (const platform of ['win32', 'darwin'] as const) {
    const values = new Map<SecretAccount, string>();
    const entry = async (account: SecretAccount): Promise<SecretEntry> => ({
      getPassword: async () => values.get(account),
      setPassword: async (value) => {
        values.set(account, value);
      },
      deleteCredential: async () => values.delete(account),
    });
    const services = createAuthServices(platform, entry);
    assert.ok(services.authStore);
    assert.equal(!!services.sessionUnlock, platform === 'darwin');
    assert.equal(
      services.authStore.location,
      platform === 'darwin' ? 'Связке ключей' : 'защищённом хранилище Windows',
    );
    const record = {
      account: 'public\\user',
      credentials: { account: 'user', password: 'secret' },
      session: { cookies: [], origins: [] },
    };
    await services.authStore.save(record);
    const reopened = createAuthServices(platform, entry);
    assert.deepEqual(await reopened.authStore!.load(), record);
    assert.deepEqual([...values.keys()], ['auth-v1']);
    await reopened.authStore!.clear();
    assert.equal(values.size, 0);
  }
  assert.equal(SECRET_SERVICE, 'bars-helper:bars.mpei.ru');
});

test('unsupported platforms keep manual login instead of a plaintext storage fallback', () => {
  const services = createAuthServices('linux', async () => {
    assert.fail('No persistence on an unsupported platform');
  });
  assert.equal(services.authStore, undefined);
  assert.equal(services.sessionUnlock, undefined);
});
