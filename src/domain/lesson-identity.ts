import type { Lesson } from './models.js';

// Reuse the timetable and headman-journal formats already handled by list-journals.js.
export const clean = (value: string) =>
  value
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// The current timetable and journal spell these same courses differently.
export const normalize = (value: string) =>
  clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\bit(?=[\s-])/g, 'ит')
    .replace(
      /^технология разработки программного обеспечения$/,
      'технологии разработки программного обеспечения',
    );
export const subjectName = (value: string) => clean(value.replace(/\s*\(.+$/u, ''));
export const isCourseProjectLesson = (type: string) =>
  /(?:^|[\s/])к[пр](?=$|[\s/])/.test(normalize(type));
// RUZ calls the journal's «консультации КП/КР» «Консультация по КР» (or «по КП»).
// Exam consultations must remain separate lessons.
export const normalizeLessonType = (type: string) =>
  /консультац/.test(normalize(type)) && isCourseProjectLesson(type)
    ? 'консультации кп/кр'
    : normalize(type);
export const lessonKey = (lesson: Pick<Lesson, 'date' | 'pair' | 'subject' | 'type'>) =>
  [
    lesson.date,
    lesson.pair,
    normalize(subjectName(lesson.subject)),
    normalizeLessonType(lesson.type),
  ].join('|');
