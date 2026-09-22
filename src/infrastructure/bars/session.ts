import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { load } from 'cheerio';
import fs from 'node:fs/promises';
import type {
  AuthenticatedLogin,
  LoginResult,
  SessionRestoreResult,
  UserProfile,
} from '../../domain/models.js';
import type { AuthGateway } from '../../features/auth/contracts.js';
import type { SessionState } from '../../features/auth/storage.js';
import { clean } from '../../domain/lesson-identity.js';
import { parseUserProfile } from './profile-parser.js';
import type { BarsClientOptions } from './options.js';
import { SessionExpiredError } from './errors.js';

type CodeForm = { action: string; referer: string; fields: [string, string][] };

/** Owns the browser context and the complete BARS authentication lifecycle. */
export class BarsSession implements AuthGateway {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private closed = false;
  private authenticated = false;
  private initialState?: string | SessionState;
  private awaitingTwoFactor = false;
  private codeForm?: CodeForm;
  readonly baseUrl: string;
  constructor(private readonly options: BarsClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://bars.mpei.ru/bars_web/';
    this.initialState = options.storageState;
  }
  public url(path: string): string {
    return new URL(path, this.baseUrl).href;
  }
  async start(): Promise<Page> {
    if (this.closed) throw new Error('Приложение закрыто.');
    if (!this.browser) this.browser = await chromium.launch({ headless: true });
    if (!this.context) {
      this.context = await this.browser.newContext({
        storageState: this.initialState,
        timezoneId: 'Europe/Moscow',
      });
      this.context.setDefaultTimeout(15_000);
      this.context.setDefaultNavigationTimeout(30_000);
      await this.context.route('**/*', (route) =>
        /(?:mc\.yandex\.ru|metrika)/.test(route.request().url()) ? route.abort() : route.continue(),
      );
      this.page = await this.context.newPage();
    }
    if (this.closed) {
      await this.browser.close();
      throw new Error('Приложение закрыто.');
    }
    return this.page!;
  }
  public checkHtml(html: string) {
    const $ = load(html);
    if ($('#AF2_Code').length || ($('#Account').length && $('#Password').length)) {
      this.expire();
    }
  }
  async getHtml(url: string, timeout = 30_000): Promise<string> {
    const page = await this.start();
    const response = await page.request.get(url, {
      headers: { referer: this.baseUrl, 'x-requested-with': 'XMLHttpRequest' },
      timeout,
    });
    if (response.status() === 401) {
      this.expire();
    }
    if (!response.ok()) throw new Error(`БАРС не вернул данные: HTTP ${response.status()}.`);
    const html = await response.text();
    this.checkHtml(html);
    return html;
  }
  private async finishAuthentication(
    html: string,
    responseUrl: string,
    verifyingCode: boolean,
    secret: string,
  ): Promise<LoginResult> {
    const $ = load(html);
    const validation = clean(
      $('.validation-summary-errors, .field-validation-error, .alert-danger').text(),
    ).replaceAll(secret, '••••');
    // On this page Account is a hidden field. Its presence does not mean the password failed.
    const form = $('#AF2_Code').closest('form');
    if (form.length) {
      const action = new URL(form.attr('action') || responseUrl, responseUrl);
      if (
        action.origin !== new URL(this.baseUrl).origin ||
        form.attr('method')?.toLowerCase() !== 'post'
      ) {
        throw new Error('Форма подтверждения входа БАРСа изменилась.');
      }
      // Capture the refreshed hidden fields on every response, including an incorrect-code response.
      this.codeForm = {
        action: action.href,
        referer: responseUrl,
        fields: form.serializeArray().map(({ name, value }) => [name, value]),
      };
      this.awaitingTwoFactor = true;
      return {
        status: 'two-factor',
        message: 'Логин и пароль приняты. Введи код двухфакторной аутентификации.',
        ...(verifyingCode
          ? { error: validation || 'Неверный или просроченный код. Попробуй ещё раз.' }
          : {}),
      };
    }
    if ($('#Password').length) {
      this.awaitingTwoFactor = false;
      this.codeForm = undefined;
      if (verifyingCode)
        throw new SessionExpiredError('Запрос кода истёк. Введи логин и пароль снова.');
      throw new Error(validation || 'БАРС не принял логин или пароль. Попробуй снова.');
    }
    return this.confirmAuthenticated();
  }

  async captureSession(): Promise<SessionState> {
    if (this.closed || !this.authenticated || !this.context)
      throw new Error('Нет подтверждённой сессии для сохранения.');
    return this.context.storageState();
  }

  private async resetContext(state?: string | SessionState): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    this.authenticated = false;
    this.initialState = state;
  }

  async restoreSession(savedState?: SessionState): Promise<SessionRestoreResult> {
    const state = savedState ?? this.options.storageState;
    if (!state) return { status: 'missing' };
    await this.resetContext(state);
    try {
      return await this.confirmAuthenticated(this.options.sessionCheckTimeoutMs ?? 8_000);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        await this.resetContext();
        return { status: 'expired' };
      }
      // Network errors, access restrictions and changed pages do not prove expiry.
      throw new Error(
        'Не удалось проверить сохранённую сессию: БАРС не ответил или страница аккаунта недоступна. Сессия сохранена — повтори проверку.',
      );
    }
  }

  private async confirmAuthenticated(timeout = 30_000): Promise<AuthenticatedLogin> {
    // One network budget for startup, including the optional profile request.
    // A slow profile must not keep an already authenticated user on the loader.
    const deadline = Date.now() + timeout;
    const html = await this.getHtml(this.baseUrl, timeout);
    if (!load(html)('a[href*="/US/User/EditUser"]').length)
      throw new Error('Вход не завершён или страница аккаунта недоступна.');
    this.awaitingTwoFactor = false;
    this.codeForm = undefined;
    this.authenticated = true;
    let profile: UserProfile | undefined;
    const warnings: string[] = [];
    const $ = load(html);
    const profileHref = $('a[href*="/US/User/EditUser"]').first().attr('href');
    if (profileHref) {
      try {
        const url = new URL(profileHref, this.baseUrl);
        if (url.origin !== new URL(this.baseUrl).origin)
          throw new Error('Unexpected profile origin');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Profile request budget exhausted');
        profile = parseUserProfile(await this.getHtml(url.href, Math.min(3_000, remaining)));
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        warnings.push('Вход выполнен, но ФИО и роль из профиля БАРСа загрузить не удалось.');
      }
    }
    return {
      status: 'authenticated',
      ...(profile ? { profile } : {}),
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    };
  }

  private async recordAuthenticationFailure(
    stage: string,
    error: unknown,
    httpStatus?: number,
  ): Promise<void> {
    // Only fixed diagnostic categories are persisted: no messages, URLs, cookies, credentials, or codes.
    const message = error instanceof Error ? error.message : '';
    const category = /Timeout|timeout/i.test(message)
      ? 'timeout'
      : /net::|ENOTFOUND|ECONN/.test(message)
        ? 'network'
        : error instanceof SessionExpiredError
          ? 'expired-session'
          : 'unexpected-response';
    await fs.mkdir('.auth', { recursive: true }).catch(() => {});
    await fs
      .writeFile(
        '.auth/last-auth-error.json',
        JSON.stringify(
          { stage, category, httpStatus, recordedAt: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600 },
      )
      .catch(() => {});
  }

  private authenticationError(error: unknown, secret: string): Error {
    // Playwright diagnostics can include values passed to fill(). Never expose them for either factor.
    if (error instanceof SessionExpiredError) return error;
    const message = error instanceof Error ? error.message : '';
    if (/locator\.|Timeout|net::|browserType\.|apiRequestContext\.|page\./.test(message)) {
      return new Error('Не удалось получить ответ БАРСа. Проверь подключение и попробуй ещё раз.');
    }
    return new Error(message.replaceAll(secret, '••••') || 'Не удалось войти в БАРС.');
  }

  async login(account: string, password: string): Promise<LoginResult> {
    if (!account || !password) throw new Error('Введи логин и пароль.');
    this.awaitingTwoFactor = false;
    this.codeForm = undefined;
    await this.resetContext();
    try {
      const page = await this.start();
      // Login always starts with a fresh session, even when a development fixture uses storageState.
      await this.context!.clearCookies();
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#Account').fill(account);
      await page.locator('#Password').fill(password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.locator('#btnLogin').click(),
      ]);
      return await this.finishAuthentication(await page.content(), page.url(), false, password);
    } catch (error) {
      throw this.authenticationError(error, password);
    }
  }

  async verifyTwoFactor(code: string): Promise<LoginResult> {
    const value = code.replace(/\s/g, '');
    if (!value) throw new Error('Введи код подтверждения.');
    const page = this.page;
    const form = this.codeForm;
    if (!page || !this.awaitingTwoFactor || !form) {
      this.awaitingTwoFactor = false;
      throw new SessionExpiredError('Запрос кода истёк. Введи логин и пароль снова.');
    }
    let stage = 'submit-code';
    let httpStatus: number | undefined;
    try {
      const fields = new URLSearchParams(form.fields);
      fields.set('AF2_Code', value);
      // This is the same form POST as the browser. The shared request context applies Set-Cookie
      // and follows redirects, without relying on a button handler or a page navigation event.
      const response = await page.request.post(form.action, {
        data: fields.toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: form.referer,
          origin: new URL(form.action).origin,
        },
        timeout: 30_000,
      });
      httpStatus = response.status();
      stage = 'read-code-response';
      if (!response.ok())
        throw new Error(`БАРС вернул HTTP ${httpStatus} при подтверждении входа.`);
      const html = await response.text();
      stage = 'check-authenticated-session';
      return await this.finishAuthentication(html, response.url(), true, value);
    } catch (error) {
      // A code can already have been accepted when the response fails. Probe access before
      // asking for another one, and never resubmit a one-time code automatically.
      if (!(error instanceof SessionExpiredError)) {
        try {
          return await this.confirmAuthenticated();
        } catch {
          /* Report the original failure. */
        }
      }
      if (error instanceof SessionExpiredError) {
        this.awaitingTwoFactor = false;
        this.codeForm = undefined;
      }
      await this.recordAuthenticationFailure(stage, error, httpStatus);
      throw this.authenticationError(error, value);
    }
  }
  expire(): never {
    this.authenticated = false;
    throw new SessionExpiredError();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser?.close();
  }
}
