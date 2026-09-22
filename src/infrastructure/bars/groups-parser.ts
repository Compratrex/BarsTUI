import { load } from 'cheerio';
import { clean } from '../../domain/lesson-identity.js';

export type StudentAccount = { studentId: string; href: string };
export type StudentMembership = StudentAccount & { name: string; status: string };

function sameOriginUrl(href: string, baseUrl: string): URL {
  const url = new URL(href, baseUrl);
  if (url.origin !== new URL(baseUrl).origin)
    throw new Error('Адрес учебной записи ведёт за пределы БАРСа.');
  return url;
}

export function parseStudentAccounts(html: string, baseUrl: string): StudentAccount[] {
  const $ = load(html);
  const section = $('label[for="StudentAccounts"]').parent();
  if (!section.length)
    throw new Error('Не удалось прочитать учебные записи аккаунта. Повтори загрузку групп.');
  const accounts = new Map<string, StudentAccount>();
  section.find('a[href*="/ST/Student/Main?"]').each((_, element) => {
    const url = sameOriginUrl($(element).attr('href')!, baseUrl);
    const studentId = url.searchParams.get('studentID');
    if (!studentId) throw new Error('В учебной записи не указан студент.');
    accounts.set(studentId, { studentId, href: url.href });
  });
  return [...accounts.values()];
}

export function parseStudentMemberships(html: string, accounts: StudentAccount[], baseUrl: string) {
  const $ = load(html);
  const table = $('#tbl__PartialListStudent');
  const headers = table
    .find('tr')
    .first()
    .find('th')
    .map((_, element) => clean($(element).text()))
    .get();
  const groupColumn = headers.findIndex((text) => text === 'Группа');
  const statusColumn = headers.findIndex((text) => text.startsWith('Статус'));
  if (!table.length || groupColumn < 0 || statusColumn < 0)
    throw new Error('Формат списка студентов изменился: не удалось прочитать группы и статусы.');
  const result = new Map<string, StudentMembership>();
  table.find('tr').each((_, row) => {
    const cells = $(row).children('td');
    if (!cells.length) return;
    const ids = new Set<string>();
    cells.find('a[href*="/ST/Student/Main?"]').each((_, element) => {
      const id = sameOriginUrl($(element).attr('href')!, baseUrl).searchParams.get('studentID');
      if (id) ids.add(id);
    });
    const matching = accounts.filter((account) => ids.has(account.studentId));
    if (!matching.length) return;
    if (matching.length !== 1 || result.has(matching[0].studentId))
      throw new Error('Учебная запись неоднозначна. Проверь список групп в БАРСе.');
    const name = clean(cells.eq(groupColumn).text());
    if (!name) throw new Error('У учебной записи не указана группа.');
    result.set(matching[0].studentId, {
      ...matching[0],
      name,
      status: clean(cells.eq(statusColumn).text()) || 'Статус не указан',
    });
  });
  const nextHref = table.attr('data-q-href');
  return {
    memberships: [...result.values()],
    nextUrl: nextHref ? sameOriginUrl(nextHref, baseUrl).href : undefined,
  };
}

export function parseStudyGroupId(html: string, baseUrl: string): string {
  const $ = load(html);
  const ids = new Set<string>();
  $('a[href*="sgID="]').each((_, element) => {
    const url = sameOriginUrl($(element).attr('href')!, baseUrl);
    if (
      !/\/(?:Open\/EmployeeSchedule\/Schedule|SG\/TrainingJournal\/ListStudyGroup__TrainingJournals)$/.test(
        url.pathname,
      )
    )
      return;
    const id = url.searchParams.get('sgID');
    if (id) ids.add(id);
  });
  if (ids.size !== 1)
    throw new Error(
      'Не удалось однозначно определить группу учебной записи. Повтори загрузку групп.',
    );
  return [...ids][0];
}
