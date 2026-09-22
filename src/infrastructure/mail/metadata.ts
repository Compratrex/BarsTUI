import { mailText } from '../../features/mail/text.js';
import { MailError, type MailPage } from '../../features/mail/contracts.js';

export type MailReadAction = 'GetOwaUserConfiguration' | 'ConvertId' | 'GetItem';
export type MailReadService = (
  action: MailReadAction,
  body: Record<string, unknown>,
) => Promise<unknown>;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function responses(value: unknown): Record<string, unknown>[] {
  const items = record(record(record(value).Body).ResponseMessages).Items;
  if (!Array.isArray(items) || items.some((item) => record(item).ResponseCode !== 'NoError'))
    throw new MailError('Outlook не вернул полные заголовки писем.');
  return items.map(record);
}
export function mailboxAddress(value: unknown): string {
  const address = record(record(value).SessionSettings).UserEmailAddress;
  if (typeof address !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(address))
    throw new MailError('Outlook не вернул адрес текущего ящика.');
  return address;
}
function envelope(action: MailReadAction, body: Record<string, unknown>) {
  return {
    __type: `${action}JsonRequest:#Exchange`,
    Header: { __type: 'JsonRequestHeaders:#Exchange', RequestServerVersion: 'Exchange2013' },
    Body: { __type: `${action}Request:#Exchange`, ...body },
  };
}
/** OWA Basic lists contain shortened subjects. GetItem reads only metadata, without UpdateItem/IsRead writes. */
export async function completeMailSubjects(
  page: MailPage,
  mailbox: string,
  service: MailReadService,
): Promise<MailPage> {
  if (!page.items.length) return page;
  const converted = responses(
    await service(
      'ConvertId',
      envelope('ConvertId', {
        SourceIds: page.items.map((item) => ({
          __type: 'AlternateId:#Exchange',
          Format: 'StoreId',
          Id: item.id,
          Mailbox: mailbox,
        })),
        DestinationFormat: 'EwsId',
      }),
    ),
  );
  const ids = converted.map((item) => record(item.AlternateId).Id);
  if (
    ids.length !== page.items.length ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  )
    throw new MailError('Outlook вернул неполный список заголовков.');
  const results = responses(
    await service(
      'GetItem',
      envelope('GetItem', {
        ItemShape: {
          __type: 'ItemResponseShape:#Exchange',
          BaseShape: 'IdOnly',
          AdditionalProperties: ['item:Subject', 'message:From'].map((FieldURI) => ({
            __type: 'PropertyUri:#Exchange',
            FieldURI,
          })),
        },
        ItemIds: ids.map((Id) => ({ __type: 'ItemId:#Exchange', Id })),
      }),
    ),
  );
  const byId = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    if (!Array.isArray(result.Items)) throw new MailError('Outlook вернул неполные заголовки.');
    for (const value of result.Items) {
      const item = record(value),
        id = record(item.ItemId).Id;
      if (typeof id !== 'string' || byId.has(id) || !ids.includes(id))
        throw new MailError('Outlook вернул заголовки других писем.');
      byId.set(id, item);
    }
  }
  return {
    ...page,
    items: page.items.map((item, i) => {
      const details = byId.get(ids[i] as string);
      if (!details || typeof details.Subject !== 'string')
        throw new MailError('Outlook не вернул полную тему письма.');
      const from = record(record(details.From).Mailbox);
      return {
        ...item,
        subject: mailText(details.Subject) || '(Без темы)',
        from: typeof from.Name === 'string' ? mailText(from.Name) || item.from : item.from,
      };
    }),
  };
}
