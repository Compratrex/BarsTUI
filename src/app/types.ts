import type { BarsDataClient } from '../domain/models.js';
import type { AuthFlow } from '../features/auth/contracts.js';
import type { MailGateway } from '../features/mail/contracts.js';
import type { Clock } from '../shared/hooks/use-clock.js';

export type AppProps = {
  client: BarsDataClient;
  auth: AuthFlow;
  mail?: MailGateway;
  now?: Clock;
  autoLogin?: boolean;
};

export type Confirmation = 'exit' | 'reload';
export type Viewport = { columns: number; rows: number };
