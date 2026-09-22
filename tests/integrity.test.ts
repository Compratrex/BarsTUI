import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIntegrity } from '../src/features/integrity/integrity.js';
import type { Lesson } from '../src/domain/models.js';

const lesson: Lesson = {
  key: 'scheduled',
  id: null,
  journalId: '1',
  date: '2026-09-17',
  pair: '3',
  start: '13:45',
  end: '15:20',
  subject: 'Управление ИТ-проектами',
  type: 'лекция',
  status: '',
};
const record = {
  ...lesson,
  id: '1',
  key: 'record',
  subject: 'Управление IT-проектами (экзамен)',
  status: 'согласовано',
  readOnly: true,
};
const after = new Date('2026-09-17T13:00:00Z');

test('missing records violate integrity only after the lesson ends in Moscow, including the exact boundary', () => {
  for (const value of [
    '2026-09-16T13:00:00Z',
    '2026-09-17T10:45:00Z',
    '2026-09-17T12:19:59.999Z',
  ]) {
    assert.equal(checkIntegrity([lesson], [], new Date(value))[0].status, 'pending');
  }
  assert.equal(
    checkIntegrity([lesson], [], new Date('2026-09-17T12:20:00Z'))[0].status,
    'violation',
  );
  assert.match(checkIntegrity([lesson], [], after)[0].details.join(' '), /записи старосты.*нет/);
});
test('an existing matching record is normal regardless of approval status, including known course and consultation aliases', () => {
  assert.equal(checkIntegrity([lesson], [record], after)[0].status, 'ok');
  const planned = {
    ...lesson,
    subject: 'Технология разработки программного обеспечения',
    type: 'Консультация по КР',
  };
  const recorded = {
    ...record,
    subject: 'Технологии разработки программного обеспечения (защита КП/КР)',
    type: 'консультации КП/КР',
  };
  assert.equal(checkIntegrity([planned], [recorded], after)[0].status, 'ok');
  assert.equal(checkIntegrity([planned], [recorded], new Date('2026-09-16'))[0].status, 'ok');
});
test('a uniquely matched wrong type, time, pair or subject explains the mismatch instead of claiming success', () => {
  for (const [changed, reason] of [
    [{ type: 'лабораторная работа' }, /Тип:/],
    [{ end: '15:25' }, /Время:/],
    [{ pair: '4' }, /Номер пары:/],
    [{ subject: 'Другая дисциплина' }, /Предмет:/],
    [{ start: '15:35', end: '17:10', pair: '4', type: 'практическое занятие' }, /Время:.*Тип:/],
  ] as const) {
    const entries = checkIntegrity([lesson], [{ ...record, ...changed }], after);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'violation');
    assert.match(entries[0].details.join(' '), reason);
  }
});
test('exact matches are reserved before pairing type mismatches in simultaneous lessons', () => {
  const practical = { ...lesson, key: 'practical', type: 'практическое занятие' };
  const correct = { ...record, id: '2', type: practical.type };
  const wrong = { ...record, type: 'лабораторная работа' };
  const result = checkIntegrity([lesson, practical], [correct, wrong], after);
  assert.equal(result.find((entry) => entry.lesson.key === 'practical')?.status, 'ok');
  assert.equal(result.find((entry) => entry.lesson.key === 'scheduled')?.recorded[0].id, '1');
});
test('duplicate records are violations, while distinct scheduled occurrences each consume one record', () => {
  const duplicate = { ...record, id: '2', key: 'duplicate' };
  const single = checkIntegrity([lesson], [record, duplicate], after);
  assert.equal(single.length, 1);
  assert.equal(single[0].status, 'violation');
  assert.equal(single[0].recorded.length, 2);
  assert.match(single[0].details.join(' '), /Дубли:/);
  assert.ok(
    checkIntegrity([lesson, { ...lesson, key: 'second' }], [record, duplicate], after).every(
      (entry) => entry.status === 'ok',
    ),
  );
});
test('wrong dates and extra records are reported without silently matching another day', () => {
  const entries = checkIntegrity([lesson], [{ ...record, date: '2026-09-18' }], after);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.status === 'violation'));
  assert.match(entries[0].details[0], /записи старосты.*нет/);
  assert.match(entries[1].details[0], /соответствующей пары.*не найдено/);
});
test('ambiguous mismatches cannot consume an arbitrary record and input snapshots are unchanged', () => {
  const scheduled = [lesson, { ...lesson, key: 'second', type: 'практическое занятие' }];
  const recorded = [{ ...record, type: 'лабораторная работа' }];
  const snapshot = structuredClone({ scheduled, recorded });
  const entries = checkIntegrity(scheduled, recorded, after);
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.status === 'violation'));
  assert.deepEqual({ scheduled, recorded }, snapshot);
  assert.deepEqual(checkIntegrity([], [], after), []);
});
