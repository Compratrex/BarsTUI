import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGradeSemesters,
  parseGradesSummary,
} from '../src/infrastructure/bars/grades-parser.js';
import { gradePage, gradeSemesters } from './fixtures/grades.js';

test('grades retain the selected semester, weeks and current-week marker', () => {
  const options = parseGradeSemesters(gradePage('27'));
  assert.deepEqual(options, { semesters: gradeSemesters, selectedId: '27' });
  const summary = parseGradesSummary(gradePage(), gradeSemesters[0], gradeSemesters);
  assert.equal(summary.weeks.length, 16);
  assert.equal(summary.weeks.find((week) => week.current)?.label, '3');
  assert.equal(summary.subjects.length, 2); // Responsive mobile titles are not extra subjects.
  assert.match(summary.subjects[0].subject, /экзамен/);
  assert.match(summary.subjects[1].subject, /защита КП\/КР/);
});

test('a missing KM number is not a grade; multiple grades, zero, decimals and attestation suffixes survive', () => {
  const summary = parseGradesSummary(gradePage(), gradeSemesters[0], gradeSemesters);
  assert.deepEqual(summary.subjects[0].weeks[3], [
    { value: '1', kind: 'missing', description: 'КМ-1. Технологии виртуализации' },
  ]);
  assert.deepEqual(
    summary.subjects[0].weeks[7].map((mark) => [mark.value, mark.kind]),
    [
      ['5', 'grade'],
      ['4', 'grade'],
    ],
  );
  assert.deepEqual(summary.subjects[1].weeks[3], [
    { value: '0', kind: 'grade', description: 'КМ-1. Проверка' },
  ]);
  assert.equal(summary.subjects[0].total[0].value, '4,25');
  assert.equal(summary.subjects[0].attestation[0].value, '4 (Д)');
  assert.equal(summary.subjects[0].final[0].value, '4');
  assert.deepEqual(summary.subjects[0].weeks[0], []);
});

test('an empty semester is recognized only for the requested semester', () => {
  assert.deepEqual(
    parseGradesSummary(gradePage('24'), gradeSemesters[2], gradeSemesters).subjects,
    [],
  );
  assert.throws(
    () => parseGradesSummary(gradePage('24'), gradeSemesters[0], gradeSemesters),
    /не вернул таблицу/,
  );
  assert.throws(
    () => parseGradesSummary('<p>Server failed</p>', gradeSemesters[0], gradeSemesters),
    /не вернул таблицу/,
  );
});

test('changed grade cells cannot silently shift a mark into another week or total column', () => {
  const broken = gradePage().replace('<td>4,25</td>', '');
  assert.throws(
    () => parseGradesSummary(broken, gradeSemesters[0], gradeSemesters),
    /Формат дисциплин/,
  );
  assert.throws(() => parseGradeSemesters('<html></html>'), /список семестров/);
});
