import type {
  AuthStore,
  SavedAuth,
  CredentialStore,
  SessionStore,
} from '../../features/auth/storage.js';
import { isSessionState } from './sessions.js';
import { accountKey } from '../../features/auth/contracts.js';
import { systemSecretEntry, type SecretEntry } from './secret-store.js';

function valid(value: unknown): value is SavedAuth {
  if (
    !value ||
    typeof value !== 'object' ||
    !('account' in value) ||
    (value.account !== null && typeof value.account !== 'string')
  )
    return false;
  if ('session' in value && value.session !== undefined && !isSessionState(value.session))
    return false;
  if ('selectedGroup' in value && value.selectedGroup !== undefined) {
    const group = value.selectedGroup;
    if (
      !value.account ||
      !group ||
      typeof group !== 'object' ||
      !('id' in group) ||
      typeof group.id !== 'string' ||
      !group.id.trim() ||
      !('studentId' in group) ||
      typeof group.studentId !== 'string' ||
      !group.studentId.trim()
    )
      return false;
  }
  if ('credentials' in value && value.credentials !== undefined) {
    const credentials = value.credentials;
    if (
      !credentials ||
      typeof credentials !== 'object' ||
      !('account' in credentials) ||
      typeof credentials.account !== 'string' ||
      !('password' in credentials) ||
      typeof credentials.password !== 'string' ||
      !credentials.password ||
      !accountKey(credentials.account) ||
      accountKey(credentials.account) !== value.account
    )
      return false;
  }
  return !('legacy' in value);
}

export class SecureAuthStore implements AuthStore {
  constructor(
    private readonly entry: () => Promise<SecretEntry> = () => systemSecretEntry('auth-v1'),
    readonly location = 'защищённом хранилище',
    private readonly legacy?: { credentials: CredentialStore; sessions: SessionStore },
  ) {}
  async load(): Promise<SavedAuth | null> {
    let secret: string | null | undefined;
    try {
      secret = await (await this.entry()).getPassword();
    } catch {
      throw new Error('Не удалось прочитать защищённое хранилище. Можно войти вручную.');
    }
    if (secret == null) {
      if (!this.legacy) return null;
      const session = await this.legacy.sessions.load();
      const credentials = await this.legacy.credentials.load();
      if (!session && !credentials) return null;
      // Separate legacy records are not proof that the password belongs to the session.
      return {
        account: session ? null : accountKey(credentials?.account),
        ...(session ? { session } : {}),
        ...(credentials ? { credentials } : {}),
        legacy: true,
      };
    }
    try {
      const record = JSON.parse(secret);
      if (record?.version !== 1 || !valid(record.auth)) throw new Error();
      return record.auth;
    } catch {
      throw new Error('Сохранённый вход повреждён. Войди вручную, чтобы заменить его.');
    }
  }
  async save(auth: SavedAuth): Promise<void> {
    if (!valid(auth)) throw new Error('Сессия и данные входа принадлежат разным аккаунтам.');
    try {
      await (await this.entry()).setPassword(JSON.stringify({ version: 1, auth }));
    } catch {
      throw new Error('Не удалось сохранить вход в защищённом хранилище.');
    }
    // The new record is authoritative before old entries are removed.
    if (this.legacy)
      await Promise.allSettled([this.legacy.credentials.clear(), this.legacy.sessions.clear()]);
  }
  async clear(): Promise<boolean> {
    const results = await Promise.allSettled([
      this.entry().then((entry) => entry.deleteCredential()),
      ...(this.legacy ? [this.legacy.credentials.clear(), this.legacy.sessions.clear()] : []),
    ]);
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Не удалось удалить все сохранённые данные входа. Повтори удаление.');
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }
}
