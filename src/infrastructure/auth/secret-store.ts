import { WindowsProtectedEntry } from './windows-secrets.js';

export const SECRET_SERVICE = 'bars-helper:bars.mpei.ru';
export type SecretAccount = 'credentials-v1' | 'session-v1' | 'auth-v1';
export type SecretEntry = {
  getPassword(): Promise<string | undefined | null>;
  setPassword(secret: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
};

export function storageLocation(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin'
    ? 'Связке ключей'
    : platform === 'win32'
      ? 'защищённом хранилище Windows'
      : 'защищённом хранилище';
}

export async function systemSecretEntry(
  account: SecretAccount,
  platform: NodeJS.Platform = process.platform,
): Promise<SecretEntry> {
  if (platform === 'win32') return new WindowsProtectedEntry(account);
  if (platform !== 'darwin') throw new Error('Сохранение данных входа доступно в macOS и Windows.');
  const { AsyncEntry } = await import('@napi-rs/keyring');
  // Preserve the existing service and account identifiers on macOS.
  return new AsyncEntry(SECRET_SERVICE, account);
}
