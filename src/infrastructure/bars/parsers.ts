import { load } from 'cheerio';
import type { Journal, Lesson } from '../../domain/models.js';
import { semesterDates } from '../../domain/time.js';

import { clean, lessonKey } from '../../domain/lesson-identity.js';

export function parseJournals(html: string, baseUrl: string): Journal[] {
  const $ = load(html);
  const journals = new Map<string, Journal>();
  $('a[href*="EditTrainingJournal"]').each((_, element) => {
    const href = new URL($(element).attr('href')!, baseUrl).href;
    const id = new URL(href).searchParams.get('tjID');
    const row = $(element).closest('tr');
    const text = clean(row.length ? row.text() : $(element).text());
    const title = text.match(/\d{4}\/\d{4},\s*(?:Осенний|Весенний)\s+семестр/i)?.[0];
    const dates = title ? semesterDates(title) : null;
    if (id && title && dates) journals.set(id, { id, title, href, ...dates });
  });
  return [...journals.values()];
}

export function parseHeadmanLessons(html: string, journalId: string): Lesson[] {
  const $ = load(html);
  const lessons: Lesson[] = [];
  $('tr').each((_, row) => {
    const title = clean($(row).find('label').first().text());
    const match = title.match(
      /^(\d{2})\.(\d{2})\.(\d{2}),\s*(\d+)\s*пара\s*\((\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\),\s*([^()]+?)\s*\(([^)]*)\),\s*(.+)$/u,
    );
    if (!match) return;
    const href = $(row).find('a[href*="EditLesson?lesID="]').attr('href') ?? '';
    const lesson: Lesson = {
      key: '',
      id: href.match(/[?&]lesID=(\d+)/i)?.[1] ?? $(row).attr('data-les-id') ?? null,
      journalId,
      readOnly: !href,
      date: `20${match[3]}-${match[2]}-${match[1]}`,
      pair: match[4],
      start: match[5],
      end: match[6],
      type: clean(match[7]),
      subject: clean(match[9]),
      status: clean($(row).find('.badge').first().text()),
    };
    lesson.key = lesson.id
      ? `lesson:${lesson.id}`
      : `record:${lessonKey(lesson)}:${lessons.length}`;
    lessons.push(lesson);
  });
  return lessons;
}

export function parseTimetable(
  html: string,
  groupName: string,
  journal: Pick<Journal, 'id' | 'startDate' | 'endDate'>,
): Lesson[] {
  const $ = load(html);
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  let date = '';
  const lessons: Lesson[] = [];
  $('tr').each((_, row) => {
    const cells = $(row)
      .find('th,td')
      .map((_, cell) => clean($(cell).text()))
      .get();
    if (cells.length === 1) {
      const match = cells[0].match(/(?:,\s*|^)(\d{1,2})\s+([а-я]+)/i);
      const month = match ? months.indexOf(match[2].toLowerCase()) + 1 : 0;
      date = '';
      if (match && month) {
        // Timetable headings omit the year. A week can cross 31 December.
        for (
          let year = Number(journal.startDate.slice(0, 4));
          year <= Number(journal.endDate.slice(0, 4));
          year++
        ) {
          const candidate = `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
          if (journal.startDate <= candidate && candidate <= journal.endDate) {
            date = candidate;
            break;
          }
        }
      }
      return;
    }
    if (!date || cells.length < 2) return;
    const pair = cells[0].match(/(\d+)\s*пара/i)?.[1];
    const time = cells[0].match(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/);
    const title = clean(
      cells[1]
        .split(groupName)[0]
        .split(/(?:[А-ЯA-Z]{1,5}-?\d[\dА-ЯA-Zа-яa-z,-]*-\d{2})/)[0]
        .split(/(?:проф\.|доц\.|ассист\.|ст\.преп\.|преп\.)/i)[0],
    );
    const subject = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!pair || !time || !subject) return;
    const lesson: Lesson = {
      key: '',
      id: null,
      journalId: journal.id,
      date,
      pair,
      start: time[1],
      end: time[2],
      subject: clean(subject[1]),
      type: clean(subject[2]),
      status: 'Нет записи в журнале',
    };
    const location = clean(cells[0].replace(time[0], '').replace(/\d+\s*пара/i, ''));
    const teacherAt = cells[1].search(/(?:проф\.|доц\.|ассист\.|ст\.\s*преп\.|преп\.)/i);
    if (location) lesson.location = location;
    if (teacherAt >= 0) lesson.teacher = clean(cells[1].slice(teacherAt));
    lesson.key = `schedule:${lessonKey(lesson)}:${lessons.length}`;
    lessons.push(lesson);
  });
  return lessons;
}

export function mergeLessons(schedule: Lesson[], recorded: Lesson[]): Lesson[] {
  const remaining = [...recorded];
  const lessons = schedule.map((scheduled) => {
    const index = remaining.findIndex(
      (lesson) => lessonKey(lesson) === lessonKey(scheduled) && lesson.start === scheduled.start,
    );
    if (index < 0) return scheduled;
    return remaining.splice(index, 1)[0];
  });
  return [...lessons, ...remaining].sort(
    (a, b) =>
      `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`) ||
      a.subject.localeCompare(b.subject, 'ru'),
  );
}
