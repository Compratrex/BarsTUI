import type { Journal, Lesson } from './models.js';

export const TIME_ZONE = 'Europe/Moscow';

export function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function lessonStart(lesson: Lesson): number {
  return Date.parse(`${lesson.date}T${lesson.start}:00+03:00`);
}

export function lessonEnd(lesson: Lesson): number {
  return Date.parse(`${lesson.date}T${lesson.end}:00+03:00`);
}

export function currentLessons(lessons: Lesson[], now: Date): Lesson[] {
  return lessons.filter(
    (lesson) => lessonStart(lesson) <= now.getTime() && now.getTime() < lessonEnd(lesson),
  );
}

export function adjacentLesson(
  lessons: Lesson[],
  current: Lesson | null,
  direction: -1 | 1,
  now: Date,
): Lesson | null {
  const sorted = [...lessons].sort(
    (a, b) => lessonStart(a) - lessonStart(b) || a.key.localeCompare(b.key),
  );
  if (current) {
    const index = sorted.findIndex((lesson) => lesson.key === current.key);
    return index < 0 ? null : (sorted[index + direction] ?? null);
  }
  return direction === 1
    ? (sorted.find((lesson) => lessonStart(lesson) > now.getTime()) ?? null)
    : (sorted.filter((lesson) => lessonEnd(lesson) <= now.getTime()).at(-1) ?? null);
}

export function displayDate(date: string): string {
  return date.split('-').reverse().join('.');
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekDates(now: Date): { startDate: string; endDate: string } {
  const today = moscowDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const startDate = shiftDate(today, -((weekday + 6) % 7));
  return { startDate, endDate: shiftDate(startDate, 6) };
}

export function semesterDates(title: string): { startDate: string; endDate: string } | null {
  const match = title.match(/(\d{4})\/(\d{4}),\s*(Осенний|Весенний)\s+семестр/i);
  if (!match) return null;
  return match[3].toLowerCase() === 'осенний'
    ? { startDate: `${match[1]}-09-01`, endDate: `${match[1]}-12-31` }
    : { startDate: `${match[2]}-02-01`, endDate: `${match[2]}-07-01` };
}

export function selectJournal(journals: Journal[], now: Date): Journal {
  const date = moscowDate(now);
  const active = journals.find((journal) => journal.startDate <= date && date <= journal.endDate);
  if (active) return active;
  const previous = journals
    .filter((journal) => journal.startDate <= date)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const result =
    previous ?? [...journals].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!result) throw new Error('Для этой группы не найдено доступных учебных журналов.');
  return result;
}
