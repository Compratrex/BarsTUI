import type { IntegrityEntry, Lesson } from '../../domain/models.js';
import {
  lessonKey,
  normalize,
  normalizeLessonType,
  subjectName,
} from '../../domain/lesson-identity.js';
import { lessonEnd, lessonStart } from '../../domain/time.js';

const sameSubject = (a: Lesson, b: Lesson) =>
  normalize(subjectName(a.subject)) === normalize(subjectName(b.subject));
const sameTime = (a: Lesson, b: Lesson) => a.start === b.start && a.end === b.end;
export const sameIntegrityLesson = (a: Lesson, b: Lesson) =>
  a.journalId === b.journalId && lessonKey(a) === lessonKey(b) && sameTime(a, b);
const exact = sameIntegrityLesson;

export function checkIntegrity(
  schedule: Lesson[],
  recorded: Lesson[],
  now: Date,
): IntegrityEntry[] {
  const remaining = new Set(recorded.map((_, index) => index));
  const matches = schedule.map(() => [] as number[]);
  // Reserve all exact matches first so a wrong type cannot steal a neighbouring valid record.
  schedule.forEach((lesson, index) => {
    const recordIndex = [...remaining].find((candidate) => exact(lesson, recorded[candidate]));
    if (recordIndex !== undefined) {
      matches[index].push(recordIndex);
      remaining.delete(recordIndex);
    }
  });
  for (const recordIndex of remaining) {
    const index = schedule.findIndex((lesson) => exact(lesson, recorded[recordIndex]));
    if (index >= 0) {
      matches[index].push(recordIndex);
      remaining.delete(recordIndex);
    }
  }

  // Explain mismatches only when the correspondence is unique in both directions.
  // Ambiguous records remain unmatched instead of being paired arbitrarily.
  const candidates: ((a: Lesson, b: Lesson) => boolean)[] = [
    (a, b) => a.date === b.date && sameSubject(a, b) && (a.pair === b.pair || a.start === b.start),
    (a, b) => a.date === b.date && sameSubject(a, b),
    (a, b) => a.date === b.date && a.pair === b.pair && sameTime(a, b),
  ];
  for (const candidate of candidates) {
    const available = schedule.map((lesson, index) => ({
      index,
      records: matches[index].length
        ? []
        : [...remaining].filter((r) => candidate(lesson, recorded[r])),
    }));
    for (const item of available) {
      if (item.records.length !== 1) continue;
      const recordIndex = item.records[0];
      if (available.filter((other) => other.records.includes(recordIndex)).length !== 1) continue;
      matches[item.index].push(recordIndex);
      remaining.delete(recordIndex);
    }
  }

  const entries = schedule.map((lesson, index): IntegrityEntry => {
    const records = matches[index].map((recordIndex) => recorded[recordIndex]);
    const details: string[] = [];
    if (!records.length) {
      const ended = lessonEnd(lesson) <= now.getTime();
      return {
        key: `schedule:${index}`,
        source: 'schedule',
        lesson,
        recorded: records,
        status: ended ? 'violation' : 'pending',
        details: [
          ended
            ? 'Пара закончилась, записи старосты в журнале нет.'
            : 'Пара ещё не закончилась — отсутствие записи пока не нарушение.',
        ],
      };
    }
    if (records.length > 1) details.push(`Дубли: в журнале ${records.length} записи вместо одной.`);
    const record = records[0];
    if (!sameSubject(lesson, record))
      details.push(`Предмет: расписание — ${lesson.subject}; журнал — ${record.subject}.`);
    if (lesson.pair !== record.pair)
      details.push(`Номер пары: расписание — ${lesson.pair}; журнал — ${record.pair}.`);
    if (!sameTime(lesson, record))
      details.push(
        `Время: расписание — ${lesson.start}–${lesson.end}; журнал — ${record.start}–${record.end}.`,
      );
    if (normalizeLessonType(lesson.type) !== normalizeLessonType(record.type))
      details.push(`Тип: расписание — ${lesson.type}; журнал — ${record.type}.`);
    return {
      key: `schedule:${index}`,
      source: 'schedule',
      lesson,
      recorded: records,
      status: details.length ? 'violation' : 'ok',
      details: details.length
        ? details
        : ['Дата, время, номер пары, предмет и тип совпадают с расписанием.'],
    };
  });
  for (const index of remaining) {
    entries.push({
      key: `record:${index}`,
      source: 'record',
      lesson: recorded[index],
      recorded: [recorded[index]],
      status: 'violation',
      details: ['Лишняя или несовпадающая запись: соответствующей пары в расписании не найдено.'],
    });
  }
  return entries.sort(
    (a, b) =>
      lessonStart(a.lesson) - lessonStart(b.lesson) ||
      a.lesson.subject.localeCompare(b.lesson.subject, 'ru'),
  );
}
