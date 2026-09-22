import type { StudyGroup } from '../../domain/models.js';
import { BarsSession } from './session.js';
import {
  parseStudentAccounts,
  parseStudentMemberships,
  parseStudyGroupId,
  type StudentMembership,
} from './groups-parser.js';

export async function loadAccountGroups(
  session: Pick<BarsSession, 'getHtml' | 'url' | 'baseUrl'>,
): Promise<StudyGroup[]> {
  const accounts = parseStudentAccounts(
    await session.getHtml(session.url('US/User/EditUser')),
    session.baseUrl,
  );
  if (!accounts.length) return [];
  const memberships = new Map<string, StudentMembership>();
  let url = session.url('ST/Student/ListStudent');
  for (let page = 1; page <= 100; page++) {
    const parsed = parseStudentMemberships(await session.getHtml(url), accounts, session.baseUrl);
    const before = memberships.size;
    for (const item of parsed.memberships) {
      const previous = memberships.get(item.studentId);
      if (previous && (previous.name !== item.name || previous.status !== item.status))
        throw new Error('Список групп изменился во время загрузки. Повтори попытку.');
      memberships.set(item.studentId, item);
    }
    if (memberships.size === accounts.length) break;
    if (!parsed.nextUrl || (page > 1 && before === memberships.size) || page === 100)
      throw new Error('Не удалось загрузить все группы аккаунта. Повтори попытку.');
    const next = new URL(parsed.nextUrl);
    next.searchParams.set(
      'query',
      JSON.stringify({ Page: String(page + 1), PageSize: '10', SortOrder: 'st_FIO' }),
    );
    url = next.href;
  }
  return Promise.all(
    accounts.map(async (account) => {
      const item = memberships.get(account.studentId)!;
      const id = parseStudyGroupId(await session.getHtml(account.href), session.baseUrl);
      return { id, name: item.name, studentId: item.studentId, status: item.status };
    }),
  );
}
