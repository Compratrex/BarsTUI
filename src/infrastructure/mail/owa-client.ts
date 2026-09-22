import type { Credentials } from '../../features/auth/storage.js';
import { accountKey } from '../../features/auth/contracts.js';
import {
  MailError,
  type MailGateway,
  type MailPage,
  type MailSummary,
} from '../../features/mail/contracts.js';
import { MAIL_URL, parseInbox, parseMailMessage } from './parser.js';
import { MailCookies } from './cookies.js';
import { completeMailSubjects, mailboxAddress, type MailReadService } from './metadata.js';
import { hasLoginForm, loginRedirect, mailLoginForm, mailUrl, MAIL_USER_AGENT } from './login.js';

export interface MailCredentials {
  withCredentials<T>(work: (credentials: Readonly<Credentials>) => Promise<T>): Promise<T>;
}

type MailSession = {
  account: string | null;
  cookies: MailCookies;
  inboxId?: string;
  mailbox?: string;
};

async function responseText(response: Response, limit: number, truncate = false): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > limit) {
      await reader.cancel();
      if (!truncate)
        throw new MailError(
          'Письмо слишком большое для терминала. Открой его на mail.mpei.ru/owa/.',
        );
      chunks.push(value.subarray(0, limit - size));
      break;
    }
    size += value.byteLength;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function responseError(response: Response, body: string): MailError {
  const serverError = response.headers.get('x-owa-error') ?? '';
  if (/TooManyObjectsOpenedException|MapiExceptionSessionLimit/.test(serverError + body)) {
    return new MailError(
      'Outlook достиг лимита открытых подключений к ящику. Подожди несколько минут и нажми R.',
    );
  }
  if (/NegotiateSecurityContext/.test(body) && /LogonDenied/.test(body)) {
    return new MailError(
      'Сервер Outlook не смог открыть ящик: сбой внутренней авторизации (HTTP 500). Проверь веб-почту и повтори позже через R.',
    );
  }
  if (response.status === 401 || response.status === 403)
    return new MailError(
      `Почта не приняла данные текущего аккаунта или доступ к ящику закрыт (HTTP ${response.status}). Проверь вход на mail.mpei.ru/owa/.`,
    );
  if (response.status >= 300 && response.status < 400)
    return new MailError('Почта перенаправила вход. Проверь доступ к ящику на mail.mpei.ru/owa/.');
  return new MailError(
    `Почта временно недоступна (HTTP ${response.status}). Нажми R, чтобы попробовать ещё раз.`,
  );
}

/** Read-only OWA Basic adapter. Passwords stay in the existing unlocked auth service. */
export class OwaMailClient implements MailGateway {
  private session?: MailSession;
  private lifetime = new AbortController();
  constructor(
    private readonly credentials: MailCredentials,
    private readonly request: typeof fetch = fetch,
  ) {}
  close() {
    this.lifetime.abort();
    this.session?.cookies.clear();
    this.session = undefined;
  }
  private async authorized<T>(
    signal: AbortSignal | undefined,
    work: (
      get: (params?: URLSearchParams) => Promise<string>,
      session: MailSession,
      service: MailReadService,
    ) => Promise<T>,
  ): Promise<T> {
    return this.credentials.withCredentials(async (credentials) => {
      const identity = accountKey(credentials.account);
      if (!this.session || identity !== this.session.account) {
        this.session?.cookies.clear();
        this.session = { account: identity, cookies: new MailCookies(new URL(MAIL_URL)) };
      }
      const session = this.session;
      const combined = AbortSignal.any([
        this.lifetime.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(20_000),
      ]);
      let loginAttempted = false;
      let metadataReady = false;
      const send = async (
        url: URL,
        data?: URLSearchParams | string,
        referer?: URL,
        action?: string,
      ) => {
        combined.throwIfAborted();
        const cookie = session.cookies.header(url);
        const canary = cookie
          .split('; ')
          .find((value) => value.startsWith('X-OWA-CANARY='))
          ?.slice(13);
        const response = await this.request(url, {
          method: data ? 'POST' : 'GET',
          redirect: 'manual',
          signal: combined,
          headers: {
            'User-Agent': MAIL_USER_AGENT,
            Accept: action ? 'application/json' : 'text/html',
            ...(cookie ? { Cookie: cookie } : {}),
            ...(data
              ? {
                  'Content-Type': action
                    ? 'application/json; charset=utf-8'
                    : 'application/x-www-form-urlencoded',
                  Origin: url.origin,
                  Referer: String(referer ?? MAIL_URL),
                  ...(action
                    ? { Action: action, 'X-OWA-CANARY': decodeURIComponent(canary ?? '') }
                    : {}),
                }
              : {}),
          },
          ...(data ? { body: data } : {}),
        });
        if (!combined.aborted && this.session === session)
          session.cookies.remember(response.headers, url);
        const body = await responseText(
          response,
          response.ok ? 8 * 1024 * 1024 : 64 * 1024,
          !response.ok,
        );
        // Exchange can redirect to an error page. Preserve that reason instead of attempting another login.
        if (response.headers.get('x-owa-error')) throw responseError(response, body);
        return { response, body };
      };
      const signIn = async (page: URL, html: string) => {
        if (loginAttempted)
          throw new MailError('Почта не приняла данные входа. Проверь их на mail.mpei.ru/owa/.');
        loginAttempted = true;
        const { action, data } = mailLoginForm(html, page, credentials);
        const result = await send(action, data, page);
        const location = result.response.headers.get('location');
        const target = location ? mailUrl(location) : null;
        session.mailbox = undefined;
        if (
          result.response.status >= 300 &&
          result.response.status < 400 &&
          target?.pathname === '/owa/'
        )
          return;
        if (result.response.ok && !hasLoginForm(result.body)) return;
        if (
          hasLoginForm(result.body) ||
          loginRedirect(result.response) ||
          result.response.status === 401 ||
          result.response.status === 403
        ) {
          throw new MailError('Почта не приняла данные входа. Проверь их на mail.mpei.ru/owa/.');
        }
        throw responseError(result.response, result.body);
      };
      const get = async (params?: URLSearchParams) => {
        const url = new URL(MAIL_URL);
        url.search = (params ?? new URLSearchParams({ layout: 'light' })).toString();
        if (!url.searchParams.has('layout')) url.searchParams.set('layout', 'light');
        try {
          let result = await send(url);
          const loginPage = loginRedirect(result.response);
          if (loginPage || (result.response.ok && hasLoginForm(result.body))) {
            const form = loginPage ? await send(loginPage) : result;
            if (!form.response.ok) throw responseError(form.response, form.body);
            await signIn(loginPage ?? url, form.body);
            // After authentication repeat only the requested read, never a server-provided mailbox action.
            result = await send(url);
          }
          if (loginRedirect(result.response) || (result.response.ok && hasLoginForm(result.body)))
            throw new MailError('Почта не приняла данные входа. Проверь их на mail.mpei.ru/owa/.');
          if (!result.response.ok) throw responseError(result.response, result.body);
          return result.body;
        } catch (error) {
          if (error instanceof MailError) throw error;
          if (signal?.aborted || this.lifetime.signal.aborted)
            throw new MailError('Загрузка почты отменена.');
          throw new MailError('Почта не ответила вовремя. Проверь подключение и нажми R.');
        }
      };
      const service: MailReadService = async (action, body) => {
        // Basic also sets a canary, but the JSON service needs premium session initialization.
        if (!metadataReady) {
          await get(new URLSearchParams({ layout: 'premium' }));
          metadataReady = true;
        }
        const result = await send(
          new URL('service.svc', MAIL_URL),
          JSON.stringify(body),
          undefined,
          action,
        );
        if (!result.response.ok) throw responseError(result.response, result.body);
        let json: unknown;
        try {
          json = JSON.parse(result.body);
        } catch {
          throw new MailError('Outlook не вернул заголовки писем.');
        }
        return json;
      };
      return work(get, session, service);
    });
  }
  async loadInbox(page = 1, signal?: AbortSignal): Promise<MailPage> {
    if (!Number.isSafeInteger(page) || page < 1)
      throw new MailError('Неверный номер страницы почты.');
    return this.authorized(signal, async (get, session, service) => {
      const complete = async (page: MailPage) => {
        if (!page.items.length) return page;
        try {
          session.mailbox ??= mailboxAddress(await service('GetOwaUserConfiguration', {}));
          return await completeMailSubjects(page, session.mailbox, service);
        } catch (error) {
          if (signal?.aborted || this.lifetime.signal.aborted) throw error;
          return {
            ...page,
            notice: 'Не удалось получить полные темы писем. Нажми R, чтобы повторить.',
          };
        }
      };
      if (!session.inboxId) {
        const first = parseInbox(await get());
        session.inboxId = first.inboxId;
        if (page === 1 && first.page === 1 && first.isInbox) return complete(first);
      }
      const result = parseInbox(
        await get(
          new URLSearchParams({
            ae: 'Folder',
            t: 'IPF.Note',
            id: session.inboxId,
            slUsng: '0',
            pg: String(page),
          }),
        ),
        page,
      );
      if (!result.isInbox || result.inboxId !== session.inboxId)
        throw new MailError('Почта открыла другую папку. Вернись в меню и повтори вход в почту.');
      return complete(result);
    });
  }
  async loadMessage(item: MailSummary, signal?: AbortSignal) {
    if (!item.id || !/^[\w.]{1,128}$/.test(item.type) || item.type.startsWith('IPM.Appointment'))
      throw new MailError('Этот тип сообщения можно посмотреть на mail.mpei.ru/owa/.');
    return this.authorized(signal, async (get) =>
      parseMailMessage(
        await get(new URLSearchParams({ ae: 'Item', t: item.type, id: item.id })),
        item,
      ),
    );
  }
}
