import type { BrowserContext } from 'playwright';
import type { StudyGroupSelection } from '../../domain/models.js';

export type Credentials = { account: string; password: string };

export interface CredentialStore {
  readonly location?: string;
  load(): Promise<Credentials | null>;
  save(credentials: Credentials): Promise<void>;
  clear(): Promise<boolean>;
}

export type SessionState = Awaited<ReturnType<BrowserContext['storageState']>>;
export interface SessionStore {
  load(): Promise<SessionState | null>;
  save(state: SessionState): Promise<void>;
  clear(): Promise<boolean>;
}

export type SavedAuth = {
  account: string | null;
  credentials?: Credentials;
  session?: SessionState;
  legacy?: boolean;
  selectedGroup?: StudyGroupSelection;
};
export interface AuthStore {
  readonly location?: string;
  load(): Promise<SavedAuth | null>;
  save(value: SavedAuth): Promise<void>;
  clear(): Promise<boolean>;
}
