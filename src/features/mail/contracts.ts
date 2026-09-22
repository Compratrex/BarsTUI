export type MailSummary = {
  id: string;
  type: string;
  subject: string;
  from: string;
  received: string;
  isRead: boolean;
  hasAttachments: boolean;
};
export type MailPage = {
  items: MailSummary[];
  page: number;
  pages: number;
  inboxId: string;
  isInbox: boolean;
  notice?: string;
};
export type MailMessage = MailSummary & { to: string; body: string; attachments: string[] };
export interface MailGateway {
  loadInbox(page?: number, signal?: AbortSignal): Promise<MailPage>;
  loadMessage(item: MailSummary, signal?: AbortSignal): Promise<MailMessage>;
}
export class MailError extends Error {}
