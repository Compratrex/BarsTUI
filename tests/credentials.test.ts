import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureCredentialStore } from '../src/infrastructure/auth/credentials.js';

class FakeSecretEntry {
  secret: string | undefined;
  async getPassword() {
    return this.secret;
  }
  async setPassword(value: string) {
    this.secret = value;
  }
  async deleteCredential() {
    const existed = this.secret !== undefined;
    this.secret = undefined;
    return existed;
  }
}

test('credentials survive a new store instance, preserve password characters, and can be updated and forgotten', async () => {
  const entry = new FakeSecretEntry();
  const factory = async () => entry;
  const first = new SecureCredentialStore(factory);
  assert.equal(await first.load(), null);
  const credentials = { account: 'тестовый-логин', password: '  кавычки"\\\n$`🗝  ' };
  await first.save(credentials);
  const second = new SecureCredentialStore(factory);
  assert.deepEqual(await second.load(), credentials);
  const replacement = { account: 'new-account', password: 'new-password' };
  await second.save(replacement);
  assert.deepEqual(await first.load(), replacement);
  assert.equal(await second.clear(), true);
  assert.equal(await first.load(), null);
  assert.equal(await second.clear(), false);
});

test('damaged or unsupported secrets fail without disclosing the stored value', async () => {
  const entry = new FakeSecretEntry();
  const store = new SecureCredentialStore(async () => entry);
  for (const secret of [
    'sensitive-raw-password',
    JSON.stringify({ version: 2, account: 'user', password: 'sensitive-raw-password' }),
    JSON.stringify({ version: 1, account: ' ', password: 'sensitive-raw-password' }),
    JSON.stringify({ version: 1, account: 'user', password: 123456 }),
  ]) {
    entry.secret = secret;
    await assert.rejects(store.load(), {
      message: 'Сохранённые данные входа повреждены. Войди вручную, чтобы заменить их.',
    });
    assert.equal(entry.secret, secret);
  }
});

test('native read, write and delete failures expose only safe actionable errors', async () => {
  const fail = async (): Promise<never> => {
    throw new Error('native error includes sensitive-secret');
  };
  for (const factory of [
    fail,
    async () => ({ getPassword: fail, setPassword: fail, deleteCredential: fail }),
  ]) {
    const store = new SecureCredentialStore(factory);
    await assert.rejects(store.load(), {
      message: 'Не удалось прочитать защищённое хранилище. Можно войти вручную.',
    });
    await assert.rejects(store.save({ account: 'user', password: 'sensitive-secret' }), {
      message: 'Не удалось сохранить данные входа в защищённом хранилище.',
    });
    await assert.rejects(store.clear(), {
      message: 'Не удалось удалить данные входа из защищённого хранилища.',
    });
  }
});

test('empty credentials cannot replace an existing login', async () => {
  const entry = new FakeSecretEntry();
  const store = new SecureCredentialStore(async () => entry);
  const credentials = { account: 'user', password: 'valid-password' };
  await store.save(credentials);
  for (const invalid of [
    { account: ' ', password: 'password' },
    { account: 'user', password: '' },
  ]) {
    await assert.rejects(store.save(invalid), /Нельзя сохранить пустой/);
    assert.deepEqual(await store.load(), credentials);
  }
});
