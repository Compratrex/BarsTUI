import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { MailView } from '../src/features/mail/MailView.js';
import { parseInbox, parseMailMessage } from '../src/infrastructure/mail/parser.js';
import type { MailGateway, MailPage } from '../src/features/mail/contracts.js';
import { inboxHtml, messageHtml } from './fixtures/mail.js';

async function key(app: ReturnType<typeof render>, input: string) {
  await delay(25);
  app.stdin.write(input);
  await delay(80);
}
test('mail pages, scrolls full text in 80×24 and preserves the list after read or refresh failures', async () => {
  const pages: number[] = [];
  let fail = false;
  const client: MailGateway = {
    loadInbox: async (page = 1) => {
      pages.push(page);
      if (fail) throw new Error('Временная ошибка почты');
      return parseInbox(inboxHtml({ page }));
    },
    loadMessage: async (item) => ({
      ...parseMailMessage(messageHtml(item.id), item),
      body:
        Array.from({ length: 80 }, (_, i) => `Строка ${i}: ${'длинный текст '.repeat(12)}`).join(
          '\n',
        ) + '\nКОНЕЦ ПИСЬМА',
    }),
  };
  const app = render(
    <Box width={80} height={18}>
      <MailView client={client} columns={80} height={18} onBack={() => {}} />
    </Box>,
  );
  try {
    await delay(120);
    assert.match(app.lastFrame() ?? '', /● Письмо 1-0/);
    await key(app, '\x1b[C');
    assert.match(app.lastFrame() ?? '', /страница 2 \/ 3/);
    await key(app, '\x1b[B');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Полная тема письма/);
    await key(app, 'G');
    assert.match(app.lastFrame() ?? '', /КОНЕЦ ПИСЬМА/);
    const frame = app.lastFrame() ?? '';
    assert.ok(frame.split('\n').length <= 18);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    await key(app, 'g');
    assert.match(app.lastFrame() ?? '', /Полная тема письма/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /страница 2 \/ 3/);
    fail = true;
    await key(app, 'r');
    assert.match(app.lastFrame() ?? '', /Временная ошибка/);
    assert.match(app.lastFrame() ?? '', /Письмо 2-1/);
    fail = false;
    await key(app, '\x1b[D');
    assert.match(app.lastFrame() ?? '', /страница 1 \/ 3/);
    await key(app, '\r');
    await key(app, '\x1b');
    assert.doesNotMatch(app.lastFrame() ?? '', /● Письмо 1-0/);
    assert.deepEqual(pages, [1, 2, 2, 1]);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('mail cancels a pending read on Escape and ignores a late response', async () => {
  let finish!: (value: MailPage) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  let backs = 0;
  const client: MailGateway = {
    loadInbox: async (_, cancel) => {
      signal = cancel;
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    loadMessage: async () => {
      assert.fail('No message before inbox');
    },
  };
  const app = render(
    <MailView
      client={client}
      columns={80}
      height={18}
      onBack={() => {
        backs++;
      }}
    />,
  );
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /Загружаем почту/);
    await key(app, 'r');
    assert.equal(calls, 1);
    await key(app, '\x1b');
    assert.equal(signal?.aborted, true);
    assert.equal(backs, 1);
    finish(parseInbox(inboxHtml()));
    await delay(100);
    assert.doesNotMatch(app.lastFrame() ?? '', /Письмо 1-0/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('inbox wraps complete subjects to terminal width and keeps selection correct across variable-height rows', async () => {
  const inbox = parseInbox(inboxHtml());
  const subject =
    'Полная тема письма с подробным описанием события и завершающими словами без сокращения';
  inbox.items = Array.from({ length: 12 }, (_, i) => ({
    ...inbox.items[i % 2],
    id: `item-${i}`,
    subject: i === 0 ? subject : `Письмо номер ${i}`,
  }));
  let opened = '';
  const client: MailGateway = {
    loadInbox: async () => inbox,
    loadMessage: async (item) => {
      opened = item.id;
      return { ...item, to: '', body: 'Текст', attachments: [] };
    },
  };
  const app = render(
    <Box width={42} height={18}>
      <MailView client={client} columns={42} height={18} onBack={() => {}} />
    </Box>,
  );
  try {
    await delay(120);
    const frame = app.lastFrame() ?? '';
    assert.ok(frame.replace(/\s+/g, ' ').includes(subject));
    assert.ok(frame.split('\n').length <= 18);
    assert.ok(frame.split('\n').every((line) => line.length <= 42));
    await key(app, '\x1b[6~');
    await key(app, '\x1b[B');
    await key(app, '\r');
    assert.equal(opened, 'item-7');
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /Письмо номер 7/);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 18);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
