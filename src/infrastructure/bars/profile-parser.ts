import { load } from 'cheerio';
import type { UserProfile } from '../../domain/models.js';
import { clean } from '../../domain/lesson-identity.js';

export function parseUserProfile(html: string): UserProfile {
  const $ = load(html);
  const account = clean($('#Account[type="text"]').first().attr('value') ?? '');

  const names = new Set<string>();
  const roles = new Set<string>();

  $('label[for="StudentAccounts"]')
    .parent()
    .find('a')
    .each((_, element) => {
      const text = clean($(element).text());
      const match = text.match(
        /^(Студент|Сотрудник|Преподаватель|Староста|Администратор)\s+([\p{L}’'-]+(?:\s+[\p{L}’'-]+){1,2})(?=\s+[\p{L}]{1,8}-\d|\s+\(|$)/u,
      );
      if (match) {
        roles.add(match[1]);
        names.add(match[2]);
      }
    });
  const fullName = names.size === 1 ? [...names][0] : undefined;
  if (!account && !fullName && !roles.size) throw new Error('Не удалось прочитать профиль БАРСа.');
  return { ...(account ? { account } : {}), ...(fullName ? { fullName } : {}), roles: [...roles] };
}
