import { load } from 'cheerio';
import type { Credentials } from '../../features/auth/storage.js';
import { MAIL_URL } from './parser.js';
import { MailError } from '../../features/mail/contracts.js';

// The MPEI gateway offers its normal CookieAuth form to supported desktop browsers.
export const MAIL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const origin = new URL(MAIL_URL).origin;
export function mailUrl(value: string, base: URL | string = MAIL_URL): URL | null {
  try {
    const url = new URL(value, base);
    return url.origin === origin && !url.username && !url.password && !url.hash ? url : null;
  } catch {
    return null;
  }
}
export function loginRedirect(response: Response): URL | null {
  const location = response.headers.get('location');
  const url = location && mailUrl(location);
  return url && url.pathname === '/CookieAuth.dll' && /^\?GetLogon(?:\?|&|$)/i.test(url.search)
    ? url
    : null;
}
export function hasLoginForm(html: string): boolean {
  return load(html)('form#logonForm input[name="password"][type="password"]').length > 0;
}
export function mailLoginForm(html: string, page: URL, credentials: Readonly<Credentials>) {
  const $ = load(html),
    form = $('form#logonForm');
  const action = mailUrl(form.attr('action') ?? '', page);
  if (
    form.length !== 1 ||
    form.attr('method')?.toLowerCase() !== 'post' ||
    !form.find('input[name="username"]').length ||
    !form.find('input[name="password"][type="password"]').length ||
    !action ||
    action.pathname !== '/CookieAuth.dll' ||
    action.search.toLowerCase() !== '?logon'
  ) {
    throw new MailError('Форма входа почты изменилась. Проверь вход на mail.mpei.ru/owa/.');
  }
  const data = new URLSearchParams();
  form
    .find('input[type="hidden"][name]')
    .each((_, el) => data.append($(el).attr('name')!, $(el).attr('value') ?? ''));
  data.set(
    'username',
    /[\\@]/.test(credentials.account) ? credentials.account : `PUBLIC\\${credentials.account}`,
  );
  data.set('password', credentials.password);
  data.set('trusted', '0'); // A session cookie; do not ask the gateway to remember the password.
  data.set('chkBsc', '1'); // Same value as checking “Use Outlook Web App Light” in flogon.js.
  return { action, data };
}
