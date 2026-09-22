import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjacentLesson,
  currentLessons,
  moscowDate,
  selectJournal,
  shiftDate,
  weekDates,
} from '../src/domain/time.js';
import {
  mergeLessons,
  parseHeadmanLessons,
  parseJournals,
  parseTimetable,
} from '../src/infrastructure/bars/parsers.js';
import { normalize, normalizeLessonType } from '../src/domain/lesson-identity.js';
import {
  attendancePayload,
  sameAttendance,
  selectAttendanceSheet,
} from '../src/infrastructure/bars/attendance-form.js';
import type { Attendance, Journal, Lesson } from '../src/domain/models.js';

export const journal: Journal = {
  id: '23',
  title: '2026/2027, Осенний семестр',
  href: 'https://example.test/journal',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
};
export const lesson: Lesson = {
  key: 'one',
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

test('current lesson uses Moscow time, inclusive start and exclusive end', () => {
  assert.equal(currentLessons([lesson], new Date('2026-09-16T10:44:59Z')).length, 0);
  assert.equal(currentLessons([lesson], new Date('2026-09-16T10:45:00Z')).length, 1);
  assert.equal(currentLessons([lesson], new Date('2026-09-16T12:20:00Z')).length, 0);
  assert.equal(moscowDate(new Date('2026-09-15T22:00:00Z')), '2026-09-16');
});
test('previous and next cross gaps and days without wrapping at boundaries', () => {
  const tomorrow = { ...lesson, key: 'two', date: '2026-09-17' };
  const lessons = [lesson, tomorrow];
  const now = new Date('2026-09-16T14:00:00Z');
  assert.equal(adjacentLesson(lessons, null, -1, now), lesson);
  assert.equal(adjacentLesson(lessons, null, 1, now), tomorrow);
  assert.equal(adjacentLesson(lessons, lesson, -1, now), null);
  assert.equal(adjacentLesson(lessons, tomorrow, 1, now), null);
});
test('simultaneous lessons are returned without choosing an arbitrary class', () => {
  assert.equal(
    currentLessons([lesson, { ...lesson, key: 'second' }], new Date('2026-09-16T11:00:00Z')).length,
    2,
  );
});
test('journal parsing deduplicates tab links and selects the current semester', () => {
  const html =
    '<table><tr><td>2026/2027, Осенний семестр</td><td><a href="/EditTrainingJournal?tjID=23">Открыть</a><a href="/EditTrainingJournal?tjID=23#Lessons">Занятия</a></td></tr><tr><td>2025/2026, Весенний семестр</td><td><a href="/EditTrainingJournal?tjID=22">Открыть</a></td></tr></table>';
  const journals = parseJournals(html, 'https://example.test');
  assert.equal(journals.length, 2);
  assert.equal(selectJournal(journals, new Date('2026-09-16')).id, '23');
  assert.equal(selectJournal(journals, new Date('2026-05-16')).id, '22');
});
test('timetable retains subject, type, date and actual pair time', () => {
  const html =
    '<table><tr><td colspan="2">среда, 16 сентября, 3 нед.</td></tr><tr><td>13:45-15:20 3 пара</td><td>Управление ИТ-проектами (Лекция) ТСТ-01м-25 доц. Преподаватель А.А.</td></tr></table>';
  const parsed = parseTimetable(html, 'ТСТ-01м-25', journal);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, lesson.date);
  assert.equal(parsed[0].start, '13:45');
  assert.equal(parsed[0].subject, lesson.subject);
});
test('weeks start on Monday in Moscow and cross month and year boundaries', () => {
  assert.deepEqual(weekDates(new Date('2026-09-20T20:59:59Z')), {
    startDate: '2026-09-14',
    endDate: '2026-09-20',
  });
  assert.deepEqual(weekDates(new Date('2026-09-20T21:00:00Z')), {
    startDate: '2026-09-21',
    endDate: '2026-09-27',
  });
  assert.deepEqual(weekDates(new Date('2027-01-01T12:00:00Z')), {
    startDate: '2026-12-28',
    endDate: '2027-01-03',
  });
  assert.equal(shiftDate('2026-12-28', 7), '2027-01-04');
  assert.equal(shiftDate('2026-03-02', -7), '2026-02-23');
});
test('timetable resolves omitted years within the requested week and preserves room and teacher', () => {
  const row = (date: string) =>
    `<tr><td colspan="2">${date}</td></tr><tr><td>13:45-15:20 3 пара Ж-211 (Корпус КИЖ)</td><td>Управление ИТ-проектами (Лекция) ТСТ-01м-25 ст. преп. Тестовый А.А.</td></tr>`;
  const parsed = parseTimetable(
    `<table>${row('понедельник, 28 декабря')}${row('пятница, 1 января')}${row('понедельник, 4 января')}</table>`,
    'ТСТ-01м-25',
    { id: '', startDate: '2026-12-28', endDate: '2027-01-03' },
  );
  assert.deepEqual(
    parsed.map((item) => item.date),
    ['2026-12-28', '2027-01-01'],
  );
  assert.equal(parsed[0].location, 'Ж-211 (Корпус КИЖ)');
  assert.equal(parsed[0].teacher, 'ст. преп. Тестовый А.А.');
  assert.equal(parsed[0].subject, 'Управление ИТ-проектами');
});
test('approved lessons keep their IDs even when Bars hides edit links', () => {
  const html =
    '<table><tr data-les-id="10"><td><label>16.09.26, 3 пара (13:45-15:20), лекция (Преподаватель А.А.), Управление IT-проектами (экзамен)</label><span class="badge">согласовано</span></td></tr></table>';
  const parsed = parseHeadmanLessons(html, '23');
  assert.equal(parsed[0].id, '10');
  assert.equal(parsed[0].readOnly, true);
  const merged = mergeLessons([lesson], parsed);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, '10');
});
test('different lesson types remain distinct and duplicate records are not discarded', () => {
  const recorded = { ...lesson, id: '1', key: 'record', subject: `${lesson.subject} (экзамен)` };
  assert.equal(
    mergeLessons([lesson], [recorded, { ...recorded, key: 'duplicate', id: '2' }]).length,
    2,
  );
  assert.equal(mergeLessons([lesson], [{ ...recorded, type: 'лабораторная работа' }]).length, 2);
});
test('observed timetable course aliases match their journal sheets', () => {
  assert.equal(
    normalize('Технология разработки программного обеспечения'),
    normalize('Технологии разработки программного обеспечения'),
  );
  assert.equal(normalize('Управление ИТ-проектами'), normalize('Управление IT-проектами'));
});
test('course project consultations match existing records without merging exam consultations', () => {
  const scheduled = {
    ...lesson,
    subject: 'Технология разработки программного обеспечения',
    type: 'Консультация по КР',
  };
  const recorded = {
    ...scheduled,
    id: '100',
    key: 'record',
    subject: 'Технологии разработки программного обеспечения (защита КП/КР)',
    type: 'консультации КП/КР',
  };
  assert.deepEqual(mergeLessons([scheduled], [recorded]), [recorded]);
  assert.equal(normalizeLessonType('Консультация по КП'), normalizeLessonType(recorded.type));
  for (const type of ['Консультация', 'Консультация перед экзаменом', 'защита КП/КР']) {
    assert.equal(mergeLessons([{ ...scheduled, type }], [recorded]).length, 2);
  }
  assert.equal(
    mergeLessons([scheduled], [recorded, { ...recorded, id: '101', key: 'duplicate' }]).length,
    2,
  );
});
test('consultations select the project sheet while ordinary lessons select the exam sheet', () => {
  const subject = 'Технологии разработки программного обеспечения';
  const exam = { value: '10', text: `${subject} (экзамен)` };
  const project = { value: '20', text: `${subject} (защита КП/КР)` };
  const consultation = {
    subject: 'Технология разработки программного обеспечения',
    type: 'Консультация по КР',
  };
  assert.equal(selectAttendanceSheet([exam, project], consultation), project);
  assert.equal(selectAttendanceSheet([exam, project], { ...consultation, type: 'лекция' }), exam);
  assert.equal(
    selectAttendanceSheet([exam, project], { ...consultation, subject: project.text }),
    project,
  );
  assert.throws(() => selectAttendanceSheet([exam], consultation), /однозначно выбрать лист/);
  assert.throws(
    () => selectAttendanceSheet([exam, { ...project, disabled: true }], consultation),
    /однозначно выбрать лист/,
  );
  assert.throws(
    () => selectAttendanceSheet([project, { ...project, value: '21' }], consultation),
    /однозначно выбрать лист/,
  );
});
test('presence converts to Bars skips, preserving excused absence and repeated teachers', () => {
  const original: Attendance = {
    editable: true,
    students: [
      { id: '10:alice', name: 'А', present: false, skipReason: 2 },
      { id: '10:bob', name: 'Б', present: false, skipReason: 1 },
      { id: '10:carol', name: 'В', present: true },
    ],
  };
  const result = attendancePayload(
    {
      action: 'https://example.test',
      fields: [
        ['__RequestVerificationToken', 'test-token'],
        ['Lesson_EmployeeID', 'teacher1'],
        ['Lesson_EmployeeID', 'teacher2'],
      ],
      groups: [
        {
          AttendanceSheetID: '10',
          Show: 's',
          Checked: false,
          Students: [{ StudentID: 'alice' }, { StudentID: 'bob' }, { StudentID: 'carol' }],
        },
      ],
    },
    original,
    new Set(['10:bob']),
  );
  const rows = JSON.parse(result.get('AttendanceSheetLessonStudentListSerialized')!)
    .AttendanceSheetLessonStudents[0].Students;
  assert.equal(rows[0].LessonSkipReasonID, 2);
  assert.equal(rows[1].LessonSkipReasonID, undefined);
  assert.equal(rows[2].LessonSkipReasonID, 1);
  assert.deepEqual(result.getAll('Lesson_EmployeeID'), ['teacher1', 'teacher2']);
  assert.equal(result.get('__RequestVerificationToken'), 'test-token');
});
test('conflict check detects roster and skip reason changes independent of order', () => {
  const original: Attendance = {
    editable: true,
    students: [
      { id: '1', name: 'А', present: true },
      { id: '2', name: 'Б', present: false, skipReason: 2 },
    ],
  };
  assert.equal(
    sameAttendance(original, { ...original, students: [...original.students].reverse() }),
    true,
  );
  assert.equal(
    sameAttendance(original, { ...original, students: original.students.slice(1) }),
    false,
  );
  assert.equal(
    sameAttendance(original, {
      ...original,
      students: original.students.map((student) => ({ ...student, present: true })),
    }),
    false,
  );
});
