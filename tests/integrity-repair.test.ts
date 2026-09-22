import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIntegrity } from '../src/features/integrity/integrity.js';
import {
  IntegrityRepairController,
  planIntegrityRepair,
} from '../src/features/integrity/integrity-repair.js';
import type { IntegrityRepairResult, IntegrityReport, Lesson } from '../src/domain/models.js';

const planned: Lesson = {
  key: 'scheduled',
  id: null,
  journalId: '1',
  date: '2026-09-17',
  pair: '3',
  start: '13:45',
  end: '15:20',
  subject: 'Предмет',
  type: 'лекция',
  status: '',
};
const record = {
  ...planned,
  key: 'record',
  id: '1',
  type: 'лабораторная работа',
  status: 'на рассмотрении',
};
const now = () => new Date('2026-09-18');
const report = (records: Lesson[]): IntegrityReport => ({
  journal: { id: '1', title: 'Семестр', href: '', startDate: '2026-09-01', endDate: '2026-12-31' },
  checkedAt: now().toISOString(),
  entries: checkIntegrity([planned], records, now()),
});

test('missing, extra, duplicate, read-only and wrong-subject records require manual decisions', async () => {
  for (const records of [
    [],
    [record, { ...record, id: '2' }],
    [{ ...record, readOnly: true }],
    [{ ...record, subject: 'Другой предмет' }],
    [{ ...record, date: '2026-09-16' }],
  ]) {
    const controller = new IntegrityRepairController({
      repairIntegrityEntry: async () => {
        assert.fail('Manual cases must not write or invent attendance');
      },
    });
    await controller.run(report(records), now);
    assert.ok(controller.snapshot().items.every((item) => item.status === 'manual'));
  }
  const plan = planIntegrityRepair(report([]).entries[0]);
  assert.equal(plan.kind, 'manual');
  if (plan.kind === 'manual') assert.equal(plan.attendance, planned);
});

test('batch runs sequentially and stop finishes only the current pair without starting another write', async () => {
  const first = report([record]).entries[0];
  const second = { ...first, key: 'second' };
  let calls = 0;
  let finish!: (result: IntegrityRepairResult) => void;
  const controller = new IntegrityRepairController({
    repairIntegrityEntry: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const running = controller.run({ ...report([]), entries: [first, second] }, now);
  assert.equal(controller.snapshot().items[0].status, 'working');
  assert.equal(controller.snapshot().items[1].status, 'queued');
  await controller.run(report([record]), now);
  assert.equal(calls, 1);
  controller.stop();
  finish({ status: 'fixed', message: 'Исправлено' });
  await running;
  assert.equal(calls, 1);
  assert.equal(controller.snapshot().running, false);
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.status),
    ['fixed', 'queued'],
  );
});

test('an unconfirmed write stops the batch, preserves prior successes and is never retried', async () => {
  const entries = Array.from({ length: 3 }, (_, index) => ({
    ...report([record]).entries[0],
    key: String(index),
  }));
  let calls = 0;
  const controller = new IntegrityRepairController({
    repairIntegrityEntry: async () => {
      if (++calls === 2) throw new Error('Сохранение не подтверждено');
      return { status: 'fixed', message: 'Исправлено' };
    },
  });
  await assert.rejects(controller.run({ ...report([]), entries }, now), /не подтверждено/);
  assert.equal(calls, 2);
  assert.equal(controller.snapshot().running, false);
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.status),
    ['fixed', 'failed', 'queued'],
  );
});
