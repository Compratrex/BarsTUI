import type { SessionState, SessionStore } from '../../features/auth/storage.js';
import { systemSecretEntry, type SecretEntry } from './secret-store.js';

export function isSessionState(value: unknown): value is SessionState {
  if (
    !value ||
    typeof value !== 'object' ||
    !('cookies' in value) ||
    !Array.isArray(value.cookies) ||
    !('origins' in value) ||
    !Array.isArray(value.origins)
  )
    return false;
  return (
    value.cookies.every(
      (cookie) =>
        cookie &&
        typeof cookie === 'object' &&
        ['name', 'value', 'domain', 'path'].every((key) => typeof cookie[key] === 'string') &&
        typeof cookie.expires === 'number' &&
        Number.isFinite(cookie.expires) &&
        typeof cookie.httpOnly === 'boolean' &&
        typeof cookie.secure === 'boolean' &&
        ['Strict', 'Lax', 'None'].includes(cookie.sameSite),
    ) &&
    value.origins.every(
      (origin) =>
        origin &&
        typeof origin === 'object' &&
        typeof origin.origin === 'string' &&
        Array.isArray(origin.localStorage) &&
        origin.localStorage.every(
          (entry: unknown) =>
            entry &&
            typeof entry === 'object' &&
            'name' in entry &&
            typeof entry.name === 'string' &&
            'value' in entry &&
            typeof entry.value === 'string',
        ),
    )
  );
}

export class SecureSessionStore implements SessionStore {
  constructor(
    private readonly createEntry: () => Promise<SecretEntry> = () =>
      systemSecretEntry('session-v1'),
  ) {}
  async load(): Promise<SessionState | null> {
    let secret: string | null | undefined;
    try {
      secret = await (await this.createEntry()).getPassword();
    } catch {
      throw new Error('Не удалось прочитать сессию из защищённого хранилища.');
    }
    if (secret == null) return null;
    try {
      const data = JSON.parse(secret);
      if (data?.version !== 1 || !isSessionState(data.state)) throw new Error();
      return data.state;
    } catch {
      throw new Error('Сохранённая сессия повреждена. Можно войти заново через Esc.');
    }
  }
  async save(state: SessionState): Promise<void> {
    if (!isSessionState(state)) throw new Error('Не удалось подготовить сессию для сохранения.');
    try {
      await (await this.createEntry()).setPassword(JSON.stringify({ version: 1, state }));
    } catch {
      throw new Error('Не удалось сохранить сессию в защищённом хранилище.');
    }
  }
  async clear(): Promise<boolean> {
    try {
      return await (await this.createEntry()).deleteCredential();
    } catch {
      throw new Error('Не удалось удалить сессию из защищённого хранилища.');
    }
  }
}
