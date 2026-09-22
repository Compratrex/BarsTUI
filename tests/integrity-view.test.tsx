import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { render } from 'ink-testing-library';
import { IntegrityView } from '../src/features/integrity/IntegrityView.js';
import { checkIntegrity } from '../src/features/integrity/integrity.js';
import type { IntegrityReport, Lesson } from '../src/domain/models.js';

const base: Lesson = {
  key: 'one',
  id: null,
  journalId: '1',
  date: '2026-09-16',
  start: '13:45',
  end: '15:20',
  pair: '3',
  type: 'лекция',
  subject: 'Первая дисциплина',
  status: '',
};
const now = new Date('2026-09-17T13:00:00Z');
const journal = {
  id: '1',
  title: '2026/2027, Осенний семестр',
  href: '',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
};
const report: IntegrityReport = {
  journal,
  checkedAt: now.toISOString(),
  entries: checkIntegrity(
    [
      base,
      { ...base, key: 'two', subject: 'Вторая дисциплина', date: '2026-09-17' },
      { ...base, key: 'three', subject: 'Третья дисциплина', date: '2026-09-18' },
    ],
    [{ ...base, id: '1' }],
    now,
  ),
};
async function key(app: ReturnType<typeof render>, input: string) {
  app.stdin.write(input);
  await delay(80);
}

test('results appear sequentially, can be shown immediately, and expose full reasons without changing records', async () => {
  let backs = 0;
  let reloads = 0;
  const app = render(
    <IntegrityView
      report={report}
      columns={76}
      height={18}
      onBack={() => backs++}
      onReload={() => reloads++}
    />,
  );
  try {
    const first = app.lastFrame() ?? '';
    assert.match(first, /Проверяем/);
    assert.match(first, /Первая дисциплина/);
    assert.doesNotMatch(first, /Вторая дисциплина|Третья дисциплина|\[ Норма \]/);
    await delay(300);
    assert.ok(
      app.frames.some(
        (frame) => frame.includes('[ Норма ]') && frame.includes('Вторая дисциплина'),
      ),
    );
    await key(app, ' ');
    assert.match(app.lastFrame() ?? '', /Готово: 3 \/ 3/);
    assert.match(app.lastFrame() ?? '', /Норма: 1 · Нарушений: 1 · Ещё не прошли: 1/);
    assert.match(app.lastFrame() ?? '', /\[ Ещё не прошла \]/);
    await key(app, '\x1b[A');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Пара закончилась, записи старосты в журнале нет/);
    await key(app, '\x1b');
    assert.equal(backs, 0);
    await key(app, 'r');
    assert.equal(reloads, 1);
    await key(app, '\x1b');
    assert.equal(backs, 1);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('a long report and its detailed reasons fit 80×24 and remain scrollable', async () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    ...report.entries[1],
    key: String(index),
    lesson: { ...base, subject: `Дисциплина ${index + 1}` },
    details: ['Длинная причина нарушения '.repeat(90) + 'Конец причины'],
  }));
  const app = render(
    <IntegrityView
      report={{ ...report, entries }}
      columns={76}
      height={18}
      onBack={() => {}}
      onReload={() => {}}
    />,
  );
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await delay(80);
    await key(app, ' ');
    let frame = app.lastFrame() ?? '';
    assert.match(frame, /Дисциплина 30/);
    assert.match(frame, /Готово: 30 \/ 30/);
    assert.ok(frame.split('\n').length <= 18);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    await key(app, '\r');
    for (let index = 0; index < 5; index++) await key(app, '\x1b[6~');
    frame = app.lastFrame() ?? '';
    assert.match(frame, /Конец причины/);
    assert.ok(frame.split('\n').length <= 18);
    await key(app, '\x1b');
    await key(app, '\x1b[5~');
    assert.match(app.lastFrame() ?? '', /Дисциплина 25/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('an empty report has no invented normal lessons', async () => {
  const app = render(
    <IntegrityView
      report={{ ...report, entries: [] }}
      columns={76}
      height={18}
      onBack={() => {}}
      onReload={() => {}}
    />,
  );
  try {
    await delay(80);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /нет пар для проверки/);
    assert.match(app.lastFrame() ?? '', /Готово: 0 \/ 0/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
