import test from 'node:test';
import assert from 'node:assert/strict';
import { MailCookies } from '../src/infrastructure/mail/cookies.js';
import { completeMailSubjects, mailboxAddress } from '../src/infrastructure/mail/metadata.js';
import { MAIL_URL, parseInbox } from '../src/infrastructure/mail/parser.js';
import { inboxHtml, metadataResponse } from './fixtures/mail.js';

test('mail metadata restores full subjects by message ID without changing read flags or fetching bodies', async () => {
  const page = parseInbox(inboxHtml()),
    actions: string[] = [];
  const result = await completeMailSubjects(page, 'student@example.test', async (action, body) => {
    actions.push(action);
    const request = body as Record<string, any>;
    if (action === 'ConvertId') {
      assert.equal(request.Body.DestinationFormat, 'EwsId');
      assert.deepEqual(
        request.Body.SourceIds.map((id: any) => [id.Format, id.Id, id.Mailbox]),
        page.items.map((item) => ['StoreId', item.id, 'student@example.test']),
      );
    } else {
      assert.equal(request.Body.ItemShape.BaseShape, 'IdOnly');
      assert.deepEqual(
        request.Body.ItemShape.AdditionalProperties.map((property: any) => property.FieldURI),
        ['item:Subject', 'message:From'],
      );
    }
    return metadataResponse(action, body);
  });
  assert.deepEqual(actions, ['ConvertId', 'GetItem']);
  for (const [i, item] of result.items.entries()) {
    assert.equal(item.subject, `Полная тема ${page.items[i].id} без сокращений`);
    assert.equal(item.from, 'Полное имя отправителя');
    assert.equal(item.id, page.items[i].id);
    assert.equal(item.isRead, page.items[i].isRead);
  }
  assert.equal(
    page.items[0].subject,
    'Письмо 1-0 & информация',
    'Original snapshot stays untouched',
  );
  assert.equal(
    mailboxAddress({ SessionSettings: { UserEmailAddress: 'student@example.test' } }),
    'student@example.test',
  );
  assert.throws(() => mailboxAddress({ SessionSettings: { UserEmailAddress: 'broken' } }));
});

test('partial or mismatched metadata never assigns one message subject to another', async () => {
  const page = parseInbox(inboxHtml());
  for (const failure of ['server', 'missing', 'foreign', 'duplicate']) {
    await assert.rejects(
      completeMailSubjects(page, 'student@example.test', async (action, body) => {
        const response = metadataResponse(action, body) as Record<string, any>;
        if (action === 'GetItem') {
          const rows = response.Body.ResponseMessages.Items;
          if (failure === 'server') rows[0].ResponseCode = 'ErrorTooManyObjectsOpened';
          if (failure === 'missing') rows.pop();
          if (failure === 'foreign') rows[0].Items[0].ItemId.Id = 'another-message';
          if (failure === 'duplicate') rows[0].Items[0].ItemId.Id = rows[1].Items[0].ItemId.Id;
        }
        return response;
      }),
      /Outlook/,
    );
  }
});

test('mail cookies obey origin, path, expiry and replacement for both login and mailbox requests', () => {
  let now = 1_000_000;
  const endpoint = new URL(MAIL_URL),
    cookies = new MailCookies(endpoint, () => now);
  const headers = new Headers();
  for (const value of [
    'login=one; Path=/; Secure; HttpOnly',
    'mail=two; Path=/owa; Domain=.mpei.ru',
    'short=three; Path=/; Max-Age=1',
    'foreign=bad; Domain=other.test',
    'default=owa-only',
  ])
    headers.append('Set-Cookie', value);
  cookies.remember(headers);
  assert.equal(cookies.header(), 'mail=two; default=owa-only; login=one; short=three');
  assert.equal(cookies.header(new URL('/CookieAuth.dll', endpoint)), 'login=one; short=three');
  assert.equal(cookies.header(new URL('/owasp', endpoint)), 'login=one; short=three');
  assert.equal(cookies.header(new URL('https://other.test/owa/')), '');
  cookies.remember(
    new Headers({ 'Set-Cookie': 'login=attacker; Path=/' }),
    new URL('https://other.test/'),
  );
  now += 1_001;
  cookies.remember(
    new Headers({ 'Set-Cookie': 'login=new; Path=/' }),
    new URL('/CookieAuth.dll', endpoint),
  );
  assert.equal(cookies.header(), 'mail=two; default=owa-only; login=new');
  cookies.remember(new Headers({ 'Set-Cookie': 'mail=; Path=/owa; Domain=mpei.ru; Max-Age=0' }));
  assert.equal(cookies.header(), 'default=owa-only; login=new');
  cookies.clear();
  assert.equal(cookies.header(), '');
});
