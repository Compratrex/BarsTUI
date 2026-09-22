import test from 'node:test';
import assert from 'node:assert/strict';
import { OwaMailClient } from '../src/infrastructure/mail/owa-client.js';
import {
  MAIL_URL,
  parseInbox,
  parseMailMessage,
  plainMailBody,
} from '../src/infrastructure/mail/parser.js';
import { mailText } from '../src/features/mail/text.js';
import { inboxHtml, messageHtml, loginHtml, metadataResponse } from './fixtures/mail.js';

test('OWA inbox decodes messages, unread state, attachments and page boundaries without evaluating scripts', () => {
  const inbox = parseInbox(inboxHtml());
  assert.equal(inbox.inboxId, 'folder+test/=');
  assert.equal(inbox.page, 1);
  assert.equal(inbox.pages, 3);
  assert.deepEqual(inbox.items[0], {
    id: 'message-1-0+/=',
    type: 'IPM.Note',
    subject: 'Письмо 1-0 & информация',
    from: 'Учебный отдел 0',
    received: '18.09.2026 10:30',
    isRead: false,
    hasAttachments: true,
  });
  assert.equal(inbox.items[1].isRead, true);
  assert.equal(parseInbox(inboxHtml({ page: 3 })).pages, 3);
  assert.equal(parseInbox(inboxHtml({ empty: true, pages: 1 })).items.length, 0);
  assert.throws(() => parseInbox('<h1>Войдите в Outlook</h1>'), /незнакомую страницу/);
  assert.throws(
    () =>
      parseInbox(
        inboxHtml().replace('href="?ae=Folder', 'href="https://other.test/owa/?ae=Folder'),
      ),
    /незнакомую страницу/,
  );
  assert.throws(
    () => parseInbox(inboxHtml().replace("onClkRdMsg(this, 'IPM.Note'", 'unknown(this')),
    /незнакомую страницу/,
  );
});

test('reading extracts only the selected message and makes HTML and terminal escapes inert', () => {
  const item = parseInbox(inboxHtml()).items[0];
  const message = parseMailMessage(messageHtml(), item);
  assert.equal(message.subject, 'Полная тема письма');
  assert.equal(message.to, 'Студент');
  assert.equal(message.from, 'Учебный отдел <department@example.test>');
  assert.equal(message.received, '18 сентября 2026');
  assert.deepEqual(message.attachments, ['Расписание.pdf']);
  assert.match(message.body, /Здравствуйте!\n\nПроверка <тегов>\./);
  assert.match(message.body, /https:\/\/example.test\/help\?q=a&x=b/);
  assert.doesNotMatch(message.body, /alert|secret|SECRET|HIDDEN|tracker|<script/);
  assert.equal(mailText('\x1b[31mRED\x1b[0m\x07\u202e'), 'RED');
  assert.equal(plainMailBody('<p>safe&#27;[2J&#7;</p>'), 'safe');
  assert.throws(() => parseMailMessage(messageHtml('another-id'), item), /незнакомую страницу/);
});

test('mail signs in through the normal form once, reuses cookies and forgets them on account changes', async () => {
  let account = 'alice',
    logins = 0,
    premiumReady = false;
  const reads: URL[] = [];
  const client = new OwaMailClient(
    { withCredentials: async (work) => work({ account, password: 'test-secret' }) },
    async (input, options) => {
      const url = new URL(String(input)),
        headers = new Headers(options?.headers);
      assert.equal(url.origin, new URL(MAIL_URL).origin);
      assert.equal(options?.redirect, 'manual');
      assert.equal(headers.get('Authorization'), null);
      assert.match(headers.get('User-Agent')!, /Mozilla/);
      assert.doesNotMatch(String(input), /secret/);
      assert.equal(url.username, '');
      assert.equal(url.password, '');
      if (url.pathname === '/CookieAuth.dll') {
        if (options?.method === 'GET') return new Response(loginHtml());
        const form = new URLSearchParams(String(options?.body));
        logins++;
        assert.equal(url.search, '?Logon');
        assert.equal(form.get('username'), `PUBLIC\\${account}`);
        assert.equal(form.get('password'), 'test-secret');
        assert.equal(form.get('trusted'), '0');
        assert.equal(form.get('chkBsc'), '1');
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/owa/',
            'Set-Cookie': `cadata=${account}; Path=/; Secure; HttpOnly`,
          },
        });
      }
      if (headers.get('Cookie')?.includes(`cadata=${account}`) !== true) {
        assert.equal(headers.get('Cookie'), null, 'Another account must not inherit mail cookies');
        return new Response(null, {
          status: 302,
          headers: { Location: '/CookieAuth.dll?GetLogon?curl=Z2FowaZ2F&formdir=2' },
        });
      }
      if (url.pathname === '/owa/service.svc') {
        assert.equal(options?.method, 'POST');
        assert.equal(headers.get('X-OWA-CANARY'), 'test/canary');
        assert.equal(premiumReady, true, 'Basic canary alone does not initialize the JSON service');
        return Response.json(
          metadataResponse(headers.get('Action')!, JSON.parse(String(options?.body))),
        );
      }
      assert.equal(options?.method, 'GET');
      if (url.searchParams.get('layout') === 'premium') {
        premiumReady = true;
        return new Response('<html>Outlook</html>', {
          headers: { 'Set-Cookie': 'X-OWA-CANARY=test%2Fcanary; Path=/owa; Secure' },
        });
      }
      premiumReady = false;
      reads.push(url);
      assert.equal(url.searchParams.get('layout'), 'light');
      if (url.searchParams.get('ae') === 'Item')
        return new Response(messageHtml(url.searchParams.get('id')!));
      if (url.searchParams.get('ae') === 'Folder')
        assert.equal(url.searchParams.get('id'), `${account}-folder`);
      return new Response(
        inboxHtml({ page: Number(url.searchParams.get('pg')) || 1, folder: `${account}-folder` }),
        { headers: { 'Set-Cookie': 'X-OWA-CANARY=test%2Fcanary; Path=/owa; Secure' } },
      );
    },
  );
  try {
    const first = await client.loadInbox();
    await client.loadInbox(2);
    await client.loadMessage(first.items[0]);
    assert.equal(logins, 1);
    assert.equal(first.notice, undefined);
    assert.equal(first.items[0].subject, 'Полная тема message-1-0+/= без сокращений');
    assert.equal(first.items[0].isRead, false);
    account = 'bob';
    await client.loadInbox(2);
    assert.equal(logins, 2);
    assert.deepEqual(
      reads.map((url) => url.searchParams.get('ae')),
      [null, 'Folder', 'Item', null, 'Folder'],
    );
    assert.equal(reads[2].searchParams.get('id'), 'message-1-0+/=');
  } finally {
    client.close();
  }
});

test('expired mail sessions authenticate once and invalid login responses never loop', async () => {
  let loggedIn = true,
    posts = 0,
    rejectLogin = false;
  const client = new OwaMailClient(
    { withCredentials: async (work) => work({ account: 'alice', password: 'secret' }) },
    async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/CookieAuth.dll') {
        if (options?.method === 'POST') {
          posts++;
          loggedIn = !rejectLogin;
          return rejectLogin
            ? new Response(loginHtml())
            : new Response(null, { status: 302, headers: { Location: '/owa/' } });
        }
        return new Response(loginHtml());
      }
      if (!loggedIn)
        return new Response(null, {
          status: 302,
          headers: { Location: '/CookieAuth.dll?GetLogon?formdir=2' },
        });
      return new Response(inboxHtml({ empty: true }));
    },
  );
  try {
    await client.loadInbox();
    loggedIn = false;
    await client.loadInbox();
    assert.equal(posts, 1);
    loggedIn = false;
    rejectLogin = true;
    await assert.rejects(client.loadInbox(), /не приняла данные входа/);
    assert.equal(posts, 2);
  } finally {
    client.close();
  }
});

test('unknown form destinations cannot receive a password and metadata failure keeps the inbox visible', async () => {
  for (const action of [
    'https://other.test/CookieAuth.dll?Logon',
    'http://mail.mpei.ru/CookieAuth.dll?Logon',
    '/owa/?delete=1',
  ]) {
    let calls = 0;
    const client = new OwaMailClient(
      { withCredentials: async (work) => work({ account: 'alice', password: 'secret' }) },
      async (_, options) => {
        calls++;
        assert.equal(options?.method, 'GET');
        return new Response(loginHtml(action));
      },
    );
    await assert.rejects(client.loadInbox(), /Форма входа/);
    assert.equal(calls, 1);
    client.close();
  }
  const client = new OwaMailClient(
    { withCredentials: async (work) => work({ account: 'alice', password: 'secret' }) },
    async (input, options) => {
      if (options?.method === 'POST') return new Response('private-server-error', { status: 500 });
      if (new URL(String(input)).searchParams.get('layout') === 'premium')
        return new Response('', { headers: { 'Set-Cookie': 'X-OWA-CANARY=test; Path=/owa' } });
      return new Response(inboxHtml());
    },
  );
  try {
    const inbox = await client.loadInbox();
    assert.equal(inbox.items.length, 2);
    assert.match(inbox.notice!, /полные темы/);
    assert.doesNotMatch(inbox.notice!, /private/);
  } finally {
    client.close();
  }
});

test('mail errors never follow a redirect with credentials or expose server response and native secrets', async () => {
  for (const [status, expected] of [
    [401, /не приняла/],
    [403, /не приняла/],
    [302, /перенаправила/],
    [500, /недоступна/],
  ] as const) {
    let calls = 0;
    const client = new OwaMailClient(
      { withCredentials: async (work) => work({ account: 'alice', password: 'secret' }) },
      async (_, options) => {
        calls++;
        assert.equal(options?.redirect, 'manual');
        return new Response('private-mail-and-token', {
          status,
          headers: { Location: 'https://other.test/' },
        });
      },
    );
    await assert.rejects(client.loadInbox(), (error) => {
      assert.match((error as Error).message, expected);
      assert.doesNotMatch((error as Error).message, /private|token|secret/);
      return true;
    });
    assert.equal(calls, 1);
    client.close();
  }
  const client = new OwaMailClient(
    { withCredentials: async (work) => work({ account: 'alice', password: 'secret' }) },
    async () => {
      throw new Error('native private-secret');
    },
  );
  await assert.rejects(client.loadInbox(), /Почта не ответила вовремя/);
  client.close();
});

test('mail cancellation and oversized responses are bounded, and missing credentials never make a request', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const credentials = {
    withCredentials: async <T>(
      work: (value: { account: string; password: string }) => Promise<T>,
    ) => work({ account: 'alice', password: 'secret' }),
  };
  const client = new OwaMailClient(credentials, async (_, options) => {
    started();
    return new Promise((_resolve, reject) =>
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  });
  const loading = client.loadInbox(1, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(loading, /отменена/);
  client.close();
  const large = new OwaMailClient(
    credentials,
    async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)),
  );
  await assert.rejects(large.loadInbox(), /слишком большое/);
  large.close();
  const locked = new OwaMailClient(
    {
      withCredentials: async () => {
        throw new Error('locked');
      },
    },
    async () => {
      assert.fail('No request before unlock');
    },
  );
  await assert.rejects(locked.loadInbox(), /locked/);
  locked.close();
});
