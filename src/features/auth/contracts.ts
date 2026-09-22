import type {
  AuthenticatedLogin,
  LoginResult,
  SessionRestoreResult,
  StudyGroupSelection,
} from '../../domain/models.js';
import type { SessionState } from './storage.js';

export type AuthenticationScreen =
  'restore' | 'restore-error' | 'unlock-error' | 'login' | 'two-factor';

export type UnlockStatus =
  'authenticated' | 'cancelled' | 'unavailable' | 'locked-out' | 'failed' | 'setup-error';
export type UnlockResult = { status: UnlockStatus };
export interface SessionUnlock {
  unlock(signal: AbortSignal): Promise<UnlockResult>;
}

export interface AuthGateway {
  restoreSession(state?: SessionState): Promise<SessionRestoreResult>;
  login(account: string, password: string): Promise<LoginResult>;
  verifyTwoFactor(code: string): Promise<LoginResult>;
  captureSession(): Promise<SessionState>;
  close(): Promise<void>;
}
export type AuthSuccess = AuthenticatedLogin & { accountKey: string | null; notice?: string };
export type AuthStep =
  AuthSuccess | Extract<LoginResult, { status: 'two-factor' }> | { status: 'login' };
export type AuthPhase = 'restore' | 'unlock' | 'login' | 'code' | 'save';
export interface AuthFlow {
  readonly canRestore: boolean;
  readonly selectedGroup: StudyGroupSelection | undefined;
  rememberGroup(group: StudyGroupSelection): Promise<string | undefined>;
  restore(phase?: (phase: AuthPhase) => void): Promise<AuthStep>;
  login(account: string, password: string): Promise<AuthStep>;
  verifyTwoFactor(code: string): Promise<AuthStep>;
  cancelChallenge(): void;
  dispose(): void;
}
export class AuthFlowError extends Error {
  constructor(
    message: string,
    readonly screen: 'restore-error' | 'unlock-error' | 'login',
    readonly unlockStatus?: Exclude<UnlockStatus, 'authenticated'>,
  ) {
    super(message);
  }
}
export function accountKey(account?: string): string | null {
  const value = account?.trim().toLowerCase();
  // BARS displays unqualified logins with its default public domain in the profile.
  return value ? (value.includes('\\') ? value : `public\\${value}`) : null;
}
