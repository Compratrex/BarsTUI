import type {
  AuthenticatedLogin,
  LoginResult,
  SessionRestoreResult,
  StudyGroupSelection,
} from '../../domain/models.js';
import type { Credentials, AuthStore, SavedAuth } from './storage.js';
import {
  accountKey,
  AuthFlowError,
  type AuthFlow,
  type AuthGateway,
  type AuthPhase,
  type AuthStep,
  type AuthSuccess,
  type SessionUnlock,
} from './contracts.js';

export class AuthService implements AuthFlow {
  private saved: SavedAuth | null = null;
  private savedLoaded = false;
  private pending: Credentials | null = null;
  private active: SavedAuth | null = null;
  private canCaptureActiveSession = false;
  private closed = false;
  private closing?: Promise<void>;
  private controller = new AbortController();
  constructor(
    private readonly gateway: AuthGateway,
    readonly store?: AuthStore,
    private readonly unlock?: SessionUnlock,
  ) {}
  get canRestore() {
    return !!this.store;
  }
  get selectedGroup() {
    return this.canCaptureActiveSession && this.active?.selectedGroup
      ? { ...this.active.selectedGroup }
      : undefined;
  }
  async rememberGroup(group: StudyGroupSelection): Promise<string | undefined> {
    this.ensureOpen();
    if (!this.canCaptureActiveSession || !this.active?.account)
      return 'Группа выбрана на этот запуск. Не удалось определить аккаунт для сохранения выбора.';
    this.active = { ...this.active, selectedGroup: { id: group.id, studentId: group.studentId } };
    if (!this.store) return 'Группа выбрана на этот запуск: защищённое хранилище недоступно.';
    const warning = await this.persist(this.active);
    return warning
      ? 'Группа выбрана, но сохранить выбор не удалось. При следующем запуске выбери её снова.'
      : undefined;
  }
  async withCredentials<T>(work: (credentials: Readonly<Credentials>) => Promise<T>): Promise<T> {
    this.ensureOpen();
    const credentials = this.active?.credentials;
    if (
      !this.canCaptureActiveSession ||
      !credentials ||
      accountKey(credentials.account) !== this.active?.account
    ) {
      throw new Error(
        'Для почты нужен пароль текущего аккаунта. Перезапусти приложение с npm start -- --login и войди в БАРС заново.',
      );
    }
    // Only the verified, unlocked account may authorize another university service.
    return work({ ...credentials });
  }
  cancelChallenge() {
    this.pending = null;
  }
  dispose() {
    this.closed = true;
    this.pending = null;
    this.controller.abort();
  }
  private ensureOpen() {
    if (this.closed) throw new Error('Приложение закрыто.');
  }
  private async persist(record: SavedAuth): Promise<string | undefined> {
    if (!this.store) return;
    try {
      if (JSON.stringify(this.saved) !== JSON.stringify(record)) await this.store.save(record);
      this.saved = record;
    } catch {
      return 'Вход выполнен, но сохранить данные входа и сессию не удалось. В хранилище остался прежний вход; для этого аккаунта при следующем запуске используй ручной вход.';
    }
  }
  private async finish(result: LoginResult, credentials?: Credentials): Promise<AuthStep> {
    this.ensureOpen();
    if (result.status === 'two-factor') return result;
    const identity = accountKey(result.profile?.account) ?? accountKey(credentials?.account);
    const matching =
      credentials && accountKey(credentials.account) === identity ? credentials : undefined;
    const record: SavedAuth = { account: identity, ...(matching ? { credentials: matching } : {}) };
    // Manual sign-in can also recover a preference, but only after verifying the account.
    if (!this.savedLoaded && this.store) {
      try {
        this.saved = await this.store.load();
        this.savedLoaded = true;
      } catch {
        /* A failed read must not prevent manual sign-in. */
      }
    }
    const previous = this.active?.account === identity ? this.active : this.saved;
    if (identity && previous?.account === identity && previous.selectedGroup)
      record.selectedGroup = { ...previous.selectedGroup };
    let warning: string | undefined;
    try {
      record.session = await this.gateway.captureSession();
    } catch {
      warning =
        'Вход выполнен, но получить сессию для сохранения не удалось. Новый вход не сохранён.';
    }
    this.ensureOpen();
    this.active = record;
    this.pending = null;
    this.canCaptureActiveSession = true;
    if (!warning) warning = await this.persist(record);
    this.ensureOpen();
    return {
      ...result,
      accountKey: identity,
      warning: [result.warning, warning].filter(Boolean).join(' ') || undefined,
      ...(!warning && this.store && matching
        ? { notice: `Данные входа сохранены в ${this.store.location ?? 'защищённом хранилище'}.` }
        : {}),
    };
  }
  async login(account: string, password: string): Promise<AuthStep> {
    this.ensureOpen();
    this.pending = { account, password };
    this.canCaptureActiveSession = false;
    try {
      return await this.finish(
        await this.gateway.login(account, password),
        this.pending ?? undefined,
      );
    } catch (error) {
      this.pending = null;
      throw error;
    }
  }
  async verifyTwoFactor(code: string): Promise<AuthStep> {
    this.ensureOpen();
    try {
      return await this.finish(await this.gateway.verifyTwoFactor(code), this.pending ?? undefined);
    } catch (error) {
      if (error instanceof Error && error.name === 'SessionExpiredError') this.pending = null;
      throw error;
    }
  }
  async restoreSession(
    phase: (phase: AuthPhase) => void = () => {},
  ): Promise<AuthSuccess | Exclude<SessionRestoreResult, AuthenticatedLogin>> {
    this.ensureOpen();
    this.pending = null;
    this.canCaptureActiveSession = false;
    phase('restore');
    try {
      this.saved = (await this.store?.load()) ?? null;
      this.savedLoaded = true;
    } catch (error) {
      throw new AuthFlowError(
        error instanceof Error ? error.message : 'Не удалось прочитать сохранённый вход.',
        'restore-error',
      );
    }
    this.ensureOpen();
    // An in-memory login must never fall back to a different persisted account after a failed write.
    if (this.active && (!this.active.account || this.saved?.account !== this.active.account)) {
      throw new AuthFlowError(
        'Сохранённый вход не соответствует текущему аккаунту. Войди вручную; черновики сохранены.',
        'login',
      );
    }
    let result: SessionRestoreResult;
    this.canCaptureActiveSession = false;
    try {
      result = await this.gateway.restoreSession(this.saved?.session);
    } catch (error) {
      throw new AuthFlowError(
        error instanceof Error ? error.message : 'Не удалось проверить сессию.',
        'restore-error',
      );
    }
    this.ensureOpen();
    if (result.status !== 'authenticated') {
      if (result.status === 'expired' && this.saved && !this.saved.legacy) {
        const { session: _expired, ...record } = this.saved;
        await this.persist(record);
      }
      return result;
    }
    const verified = accountKey(result.profile?.account);
    if (verified && this.saved?.account && verified !== this.saved.account)
      throw new AuthFlowError(
        'Аккаунт сессии не совпадает с сохранённым входом. Войди вручную.',
        'login',
      );
    if (this.unlock) {
      phase('unlock');
      let status;
      try {
        status = (await this.unlock.unlock(this.controller.signal)).status;
      } catch {
        status = 'failed' as const;
      }
      this.ensureOpen();
      if (status !== 'authenticated')
        throw new AuthFlowError('Сохранённая сессия заблокирована.', 'unlock-error', status);
    }
    const identity = verified ?? (!this.saved?.legacy ? this.saved?.account : null) ?? null;
    const credentials =
      identity && accountKey(this.saved?.credentials?.account) === identity
        ? this.saved?.credentials
        : undefined;
    const restored = {
      ...result,
      profile: {
        ...result.profile,
        account: result.profile?.account ?? identity ?? undefined,
        roles: result.profile?.roles ?? [],
      },
    };
    return (await this.finish(restored, credentials)) as AuthSuccess;
  }
  async restore(phase: (phase: AuthPhase) => void = () => {}): Promise<AuthStep> {
    const result = await this.restoreSession(phase);
    if (result.status === 'authenticated') return result;
    // Never use an unverified password paired with a legacy session from another account.
    if (this.saved?.legacy && this.saved.session) return { status: 'login' };
    const credentials = this.saved?.credentials;
    if (!credentials || accountKey(credentials.account) !== this.saved?.account)
      return { status: 'login' };
    phase('login');
    try {
      return await this.login(credentials.account, credentials.password);
    } catch (error) {
      throw new AuthFlowError(
        error instanceof Error ? error.message : 'Не удалось войти.',
        'login',
      );
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.dispose();
    this.closing = (async () => {
      try {
        if (this.active && this.canCaptureActiveSession) {
          try {
            await this.persist({ ...this.active, session: await this.gateway.captureSession() });
          } catch {
            /* An expired or incomplete login must not replace the saved record. */
          }
        }
      } finally {
        await this.gateway.close();
      }
    })();
    return this.closing;
  }
}
