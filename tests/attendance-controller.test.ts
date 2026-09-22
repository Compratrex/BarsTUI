import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceController, changed } from '../src/features/attendance/attendance-controller.js';
import type { Attendance, AttendanceGateway, Journal, Lesson } from '../src/domain/models.js';

const journal: Journal = {
  id: '23',
  title: 'Семестр',
  href: '',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
};
const planned: Lesson = {
  key: 'schedule:one',
  id: null,
  journalId: '23',
  date: '2026-09-16',
  start: '13:45',
  end: '15:20',
  pair: '3',
  type: 'лекция',
  subject: 'Управление ИТ-проектами',
  status: 'Нет записи в журнале',
};
const recorded: Lesson = {
  ...planned,
  key: 'lesson:100',
  id: '100',
  subject: 'Управление IT-проектами (экзамен)',
  status: 'на рассмотрении',
};
const roster: Attendance = {
  editable: true,
  students: [{ id: 'alice', name: 'А', present: false }],
};
const now = new Date('2026-09-16');

test('reload after unconfirmed creation resolves the new journal ID without resubmitting attendance', async () => {
  let exists = false;
  let writes = 0;
  const reads: (string | null)[] = [];
  const gateway: AttendanceGateway = {
    loadLessons: async () => ({ journal, lessons: [exists ? recorded : planned] }),
    loadAttendance: async (lesson) => {
      reads.push(lesson.id);
      return {
        ...roster,
        students: roster.students.map((student) => ({ ...student, present: !!lesson.id })),
      };
    },
    saveAttendance: async () => {
      exists = true;
      writes++;
      throw new Error('Результат сохранения не подтверждён.');
    },
  };
  const controller = new AttendanceController(gateway);
  controller.activate('alice');
  await controller.loadLessons(now);
  await controller.openLesson(planned);
  controller.selectAll();
  await assert.rejects(controller.save(), /не подтверждён/);
  assert.equal(controller.snapshot().lesson?.id, null);
  await controller.reload(now);
  assert.equal(controller.snapshot().lesson?.id, '100');
  assert.equal(controller.snapshot().lesson?.key, planned.key);
  assert.equal(changed(controller.snapshot().drafts.get(planned.key)!), false);
  assert.deepEqual(reads, [null, '100']);
  assert.equal(writes, 1);
  assert.equal(planned.id, null);
  assert.equal(recorded.key, 'lesson:100');
});

test('explicit save result updates the current lesson and list while keeping source objects unchanged', async () => {
  Object.freeze(planned);
  const gateway: AttendanceGateway = {
    loadLessons: async () => ({ journal, lessons: [planned] }),
    loadAttendance: async () => structuredClone(roster),
    saveAttendance: async (lesson) => ({
      lesson: { ...recorded, key: lesson.key },
      attendance: {
        ...roster,
        students: roster.students.map((student) => ({ ...student, present: true })),
      },
    }),
  };
  const controller = new AttendanceController(gateway);
  controller.activate('alice');
  await controller.loadLessons(now);
  await controller.openLesson(planned);
  controller.selectAll();
  await controller.save();
  assert.equal(controller.snapshot().lesson?.id, '100');
  assert.equal(controller.snapshot().lessons[0].status, 'на рассмотрении');
  assert.equal(controller.hasChanges, false);
  assert.equal(planned.id, null);
});

test('ambiguous records after a failed creation do not discard the draft or select an arbitrary duplicate', async () => {
  let exists = false;
  const gateway: AttendanceGateway = {
    loadLessons: async () => ({
      journal,
      lessons: exists ? [recorded, { ...recorded, key: 'lesson:101', id: '101' }] : [planned],
    }),
    loadAttendance: async (lesson) => {
      assert.equal(lesson.id, null);
      return structuredClone(roster);
    },
    saveAttendance: async () => {
      throw new Error('unused');
    },
  };
  const controller = new AttendanceController(gateway);
  controller.activate('alice');
  await controller.loadLessons(now);
  await controller.openLesson(planned);
  controller.selectAll();
  exists = true;
  await assert.rejects(controller.reload(now));
  assert.equal(controller.hasChanges, true);
  assert.equal(controller.snapshot().lesson?.id, null);
});
