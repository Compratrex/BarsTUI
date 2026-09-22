import type { SessionState } from '../../features/auth/storage.js';

export type BarsClientOptions = {
  baseUrl?: string;
  storageState?: string | SessionState;
  sessionCheckTimeoutMs?: number;
};
