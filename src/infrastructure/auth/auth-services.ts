import { SecureCredentialStore } from './credentials.js';
import { SecureSessionStore } from './sessions.js';
import {
  storageLocation,
  systemSecretEntry,
  type SecretAccount,
  type SecretEntry,
} from './secret-store.js';
import { SecureAuthStore } from './auth-store.js';
import { TouchIdSessionUnlock } from './touch-id.js';

export function createAuthServices(
  platform: NodeJS.Platform = process.platform,
  entry: (account: SecretAccount) => Promise<SecretEntry> = (account) =>
    systemSecretEntry(account, platform),
) {
  const supported = platform === 'darwin' || platform === 'win32';
  const legacy = supported
    ? {
        credentials: new SecureCredentialStore(
          () => entry('credentials-v1'),
          storageLocation(platform),
        ),
        sessions: new SecureSessionStore(() => entry('session-v1')),
      }
    : undefined;
  return {
    authStore: supported
      ? new SecureAuthStore(() => entry('auth-v1'), storageLocation(platform), legacy)
      : undefined,
    sessionUnlock: platform === 'darwin' ? new TouchIdSessionUnlock() : undefined,
  };
}
