import { load } from 'cheerio';
import type { GradeCell, GradesSummary, GradeSemester, GradeSubject } from '../../domain/models.js';
import { clean } from '../../domain/lesson-identity.js';

export function parseGradeSemesters(html: string): {
  semesters: GradeSemester[];
  selectedId: string;
} {
  const $ = load(html);
  const options = $('#ddl_StudyFilterSemester option');
  const semesters = options
    .map((_, option) => ({ id: $(option).attr('value') ?? '', title: clean($(option).text()) }))
    .get()
    .filter((item) => item.id && item.title);
  if (!semesters.length) throw new Error('БАРС не вернул список семестров для оценок.');
  return { semesters, selectedId: options.filter('[selected]').attr('value') || semesters[0].id };
}

export function parseGradesSummary(
  html: string,
  semester: GradeSemester,
  semesters: GradeSemester[],
): GradesSummary {
  const $ = load(html);
  const table = $('#tableMarkSummary');
  // For semesters before the student's enrollment, Bars returns only its semester selector.
  if (!table.length && $('#ddl_StudyFilterSemester').length && !$('h1,h2,h3,h4,h5,table').length) {
    const { selectedId } = parseGradeSemesters(html);
    if (selectedId === semester.id) return { semester, semesters, weeks: [], subjects: [] };
  }
  if (table.length !== 1)
    throw new Error('БАРС не вернул таблицу оценок. Попробуй обновить данные.');
  const weekHeaders = table.find('thead tr').eq(1).children('th');
  const weeks = weekHeaders
    .map((_, element) => ({
      label: clean($(element).text()),
      current: $(element).hasClass('summary-td-current-week'),
    }))
    .get();
  if (!weeks.length || weeks.some((week) => !/^\d+$/.test(week.label)))
    throw new Error('Формат недель в таблице оценок БАРСа изменился.');
  const readCell = (html: string): GradeCell => {
    const cell = load(html);
    const marks = cell('.summary-mark, .summary-km');
    if (marks.length)
      return marks
        .map((_, element) => {
          const value = clean(cell(element).text());
          const description = clean(cell(element).attr('title') ?? '');
          return {
            value,
            kind: cell(element).hasClass('summary-mark')
              ? ('grade' as const)
              : ('missing' as const),
            ...(description ? { description } : {}),
          };
        })
        .get()
        .filter((mark) => mark.value);
    const value = clean(cell.root().text());
    return value ? [{ value, kind: 'text' }] : [];
  };
  const subjects: GradeSubject[] = [];
  table
    .find('tbody > tr')
    .not('.summary-header-min')
    .each((_, row) => {
      const cells = $(row).children('td');
      if (!cells.length) return;
      if (cells.length !== weeks.length + 4 || !cells.first().hasClass('summary-td-row-header'))
        throw new Error('Формат дисциплин в таблице оценок БАРСа изменился.');
      const subject = clean(cells.first().text());
      if (!subject) throw new Error('Не удалось прочитать название дисциплины в оценках БАРСа.');
      const values = cells
        .slice(1)
        .map((_, cell) => [readCell($(cell).html() ?? '')])
        .get();
      subjects.push({
        subject,
        weeks: values.slice(0, weeks.length),
        total: values[weeks.length],
        attestation: values[weeks.length + 1],
        final: values[weeks.length + 2],
      });
    });
  return { semester, semesters, weeks, subjects };
}
