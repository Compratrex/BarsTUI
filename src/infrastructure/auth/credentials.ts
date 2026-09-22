import type { Credentials, CredentialStore } from '../../features/auth/storage.js';
import { storageLocation, systemSecretEntry, type SecretEntry } from './secret-store.js';

export class SecureCredentialStore implements CredentialStore {
  constructor(
    private readonly createEntry: () => Promise<SecretEntry> = () =>
      systemSecretEntry('credentials-v1'),
    readonly location = storageLocation(),
  ) {}

  async load(): Promise<Credentials | null> {
    let secret: string | undefined | null;
    try {
      secret = await (await this.createEntry()).getPassword();
    } catch {
      throw new Error('Не удалось прочитать защищённое хранилище. Можно войти вручную.');
    }
    if (secret == null) return null;
    try {
      const data: unknown = JSON.parse(secret);
      if (
        !data ||
        typeof data !== 'object' ||
        !('version' in data) ||
        data.version !== 1 ||
        !('account' in data) ||
        typeof data.account !== 'string' ||
        !data.account.trim() ||
        !('password' in data) ||
        typeof data.password !== 'string' ||
        !data.password
      )
        throw new Error();
      return { account: data.account, password: data.password };
    } catch {
      // JSON parser and native errors must never reveal any part of the secret.
      throw new Error('Сохранённые данные входа повреждены. Войди вручную, чтобы заменить их.');
    }
  }

  async save({ account, password }: Credentials): Promise<void> {
    if (!account.trim() || !password) throw new Error('Нельзя сохранить пустой логин или пароль.');
    try {
      const entry = await this.createEntry();
      // Both values go into the encrypted secret, not the entry metadata.
      await entry.setPassword(JSON.stringify({ version: 1, account, password }));
    } catch {
      throw new Error('Не удалось сохранить данные входа в защищённом хранилище.');
    }
  }

  async clear(): Promise<boolean> {
    try {
      return await (await this.createEntry()).deleteCredential();
    } catch {
      throw new Error('Не удалось удалить данные входа из защищённого хранилища.');
    }
  }
}
