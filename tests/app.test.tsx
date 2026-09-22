import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { render } from 'ink-testing-library';
import { useMemo } from 'react';
import { AuthService } from '../src/features/auth/auth-service.js';
import type { AuthStore, SavedAuth, Credentials } from '../src/features/auth/storage.js';
import {
  accountKey,
  type AuthGateway,
  type SessionUnlock,
  type UnlockResult,
} from '../src/features/auth/contracts.js';
import { App as Application } from '../src/app/App.js';
import type {
  StudyGroup,
  StudyGroupSelection,
  Attendance,
  BarsDataClient,
  GradesSummary,
  IntegrityEntry,
  IntegrityRepairResult,
  Journal,
  Lesson,
  LoginResult,
  SessionRestoreResult,
  WeekSchedule,
} from '../src/domain/models.js';
import { weekDates } from '../src/domain/time.js';
import type { MailGateway } from '../src/features/mail/contracts.js';
import { parseInbox, parseMailMessage } from '../src/infrastructure/mail/parser.js';
import { inboxHtml, messageHtml } from './fixtures/mail.js';
import { parseGradesSummary } from '../src/infrastructure/bars/grades-parser.js';
import { gradePage, gradeSemesters } from './fixtures/grades.js';
import { studyGroups } from './fixtures/groups.js';
import { profileName } from './fixtures/profile.js';
import { checkIntegrity } from '../src/features/integrity/integrity.js';

const credentials: Credentials = { account: 'test-user', password: 'private-password' };
class MemoryAuthStore implements AuthStore {
  loads = 0;
  credentialWrites: Credentials[] = [];
  record: SavedAuth | null;
  constructor(credentials: Credentials | null = null) {
    this.record = credentials ? { account: accountKey(credentials.account), credentials } : null;
  }
  get stored() {
    return this.record?.credentials ?? null;
  }
  async load() {
    this.loads++;
    return structuredClone(this.record);
  }
  async save(value: SavedAuth) {
    if (value.credentials && JSON.stringify(value.credentials) !== JSON.stringify(this.stored))
      this.credentialWrites.push({ ...value.credentials });
    this.record = structuredClone(value);
  }
  async clear() {
    const existed = this.record !== null;
    this.record = null;
    return existed;
  }
}
function App({
  client,
  authStore,
  sessionUnlock,
  ...props
}: {
  client: BarsDataClient & AuthGateway;
  mail?: MailGateway;
  authStore?: AuthStore;
  sessionUnlock?: SessionUnlock;
  now?: () => Date;
  autoLogin?: boolean;
}) {
  const auth = useMemo(
    () => new AuthService(client, authStore, sessionUnlock),
    [client, authStore, sessionUnlock],
  );
  return <Application client={client} auth={auth} {...props} />;
}

const journal: Journal = {
  id: '23',
  title: '2026/2027, Осенний семестр',
  href: '',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
};
const lesson: Lesson = {
  key: 'one',
  id: '1',
  journalId: '23',
  date: '2026-09-16',
  start: '13:45',
  end: '15:20',
  pair: '3',
  type: 'лекция',
  subject: 'Управление ИТ-проектами',
  status: 'на рассмотрении',
};
const next: Lesson = { ...lesson, key: 'two', id: '2', date: '2026-09-17' };
class FakeClient implements BarsDataClient, AuthGateway {
  groups: StudyGroup[] = [
    { id: 'group', name: 'Тестовая группа', studentId: 'fixture-student', status: 'обучается' },
  ];
  selectedGroup: StudyGroup | null = null;
  groupReads = 0;
  async loadGroups() {
    this.groupReads++;
    return structuredClone(this.groups);
  }
  selectGroup(choice: StudyGroupSelection) {
    this.selectedGroup =
      this.groups.find((group) => group.id === choice.id && group.studentId === choice.studentId) ??
      null;
    if (!this.selectedGroup) throw new Error('Группа недоступна');
  }
  clearGroup() {
    this.selectedGroup = null;
  }

  async captureSession() {
    return { cookies: [], origins: [] };
  }
  async restoreSession(): Promise<SessionRestoreResult> {
    return { status: 'missing' };
  }
  calls: Set<string>[] = [];
  scheduleDates: string[] = [];
  gradeCalls: string[] = [];
  async loadGrades(semesterId = '28'): Promise<GradesSummary> {
    this.gradeCalls.push(semesterId);
    return parseGradesSummary(
      gradePage(semesterId),
      gradeSemesters.find((item) => item.id === semesterId)!,
      gradeSemesters,
    );
  }
  attendance: Attendance = {
    editable: true,
    students: [
      { id: '1', name: 'Тестовый студент А', present: false },
      { id: '2', name: 'Тестовый студент Б', present: false },
    ],
  };
  async login(account: string, password: string): Promise<LoginResult> {
    assert.equal(account, 'test-user');
    assert.equal(password, 'private-password');
    return { status: 'authenticated' };
  }
  async verifyTwoFactor(_code: string): Promise<LoginResult> {
    return { status: 'authenticated' };
  }
  async loadLessons() {
    return { journal, lessons: [lesson, next] };
  }
  async repairIntegrityEntry(_entry: IntegrityEntry, _now: Date): Promise<IntegrityRepairResult> {
    throw new Error('Unexpected repair');
  }
  async loadIntegrity(now: Date) {
    return {
      journal,
      checkedAt: now.toISOString(),
      entries: checkIntegrity([lesson, next], [lesson], now),
    };
  }
  async loadSchedule(date: Date): Promise<WeekSchedule> {
    const range = weekDates(date);
    this.scheduleDates.push(range.startDate);
    return {
      groupName: 'ТСТ-01м-25',
      ...range,
      lessons: [lesson, next]
        .filter((item) => range.startDate <= item.date && item.date <= range.endDate)
        .map((item) => ({
          ...item,
          location: 'Ж-211 (Корпус КИЖ)',
          teacher: 'доц. Тестовый А.А.',
        })),
    };
  }
  async loadAttendance(_lesson: Lesson) {
    return structuredClone(this.attendance);
  }
  async saveAttendance(_lesson: Lesson, _original: Attendance, selected: Set<string>) {
    this.calls.push(new Set(selected));
    this.attendance.students = this.attendance.students.map((student) => ({
      ...student,
      present: selected.has(student.id),
    }));
    return { lesson: { ..._lesson }, attendance: structuredClone(this.attendance) };
  }
  async close() {}
}
async function key(app: ReturnType<typeof render>, value: string) {
  // A newly mounted screen subscribes to input in an effect, after its first frame.
  await delay(25);
  app.stdin.write(value);
  await delay(100);
}
async function enterCredentials(app: ReturnType<typeof render>) {
  await delay(80);
  await key(app, 'test-user');
  await key(app, '\r');
  await key(app, 'private-password');
  assert.doesNotMatch(app.lastFrame() ?? '', /private-password/);
  await key(app, '\r');
}
async function login(app: ReturnType<typeof render>) {
  await enterCredentials(app);
  assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
  await key(app, '\r');
}
test('login → current pair → presence selection → explicit verified save', async () => {
  const client = new FakeClient();
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    assert.match(app.lastFrame() ?? '', /\[Логин\]/);
    await login(app);
    assert.match(app.lastFrame() ?? '', /Тестовый студент А/);
    await key(app, '\r');
    assert.equal(client.calls.length, 0);
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    await key(app, '\x13');
    assert.deepEqual([...client.calls[0]], ['1']);
    assert.match(app.lastFrame() ?? '', /Посещаемость сохранена/);
    assert.equal(
      app.frames.some((frame) => frame.includes('private-password')),
      false,
    );
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('between lessons, previous/next and lesson list are usable', async () => {
  const app = render(
    <App client={new FakeClient()} now={() => new Date('2026-09-16T16:00:00Z')} />,
  );
  try {
    await login(app);
    assert.match(app.lastFrame() ?? '', /Текущей пары нет/);
    await key(app, '\x1b[C');
    assert.match(app.lastFrame() ?? '', /17\.09\.2026/);
    await key(app, '\x1b[D');
    assert.match(app.lastFrame() ?? '', /16\.09\.2026/);
    await key(app, 'l');
    assert.match(app.lastFrame() ?? '', /2 ·|1 \/ 2/);
    await key(app, '\x1b[B');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /17\.09\.2026/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('draft selections survive navigating to another lesson and back', async () => {
  const client = new FakeClient();
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await login(app);
    await key(app, ' ');
    await key(app, '\x1b[C');
    await key(app, '\x1b[D');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('all lessons show statuses before loading a roster, open the chosen pair and return to the list with drafts intact', async () => {
  const client = new FakeClient();
  const opened: string[] = [];
  let reads = 0;
  const records: Lesson[] = [
    lesson,
    { ...next, status: 'требуется корректировка' },
    {
      ...next,
      key: 'approved',
      id: '3',
      date: '2026-09-18',
      status: 'согласовано',
      readOnly: true,
    },
    {
      ...next,
      key: 'planned',
      id: null,
      date: '2026-09-19',
      subject: 'Очень длинное название предмета '.repeat(5),
      status: 'Нет записи в журнале',
    },
  ];
  client.loadLessons = async () => {
    reads++;
    return { journal, lessons: records };
  };
  client.loadAttendance = async (target) => {
    opened.push(target.key);
    return structuredClone(client.attendance);
  };
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    await key(app, '\r');
    await delay(400); // The initial text reveal finishes before checking the full list.
    const frame = app.lastFrame() ?? '';
    assert.match(frame, /БАРС · Все пары/);
    for (const status of [
      'На рассмотрении',
      'Требуется корректировка',
      'Согласовано',
      'Нет записи в журнале',
    ])
      assert.ok(frame.includes(`[ ${status} ]`));
    assert.match(frame, /16\.09\.2026 · Среда/);
    assert.match(frame, /13:45–15:20 · 3 пара · лекция/);
    assert.ok(frame.split('\n').length <= 24);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    assert.deepEqual(opened, []);
    assert.equal(reads, 1);
    await key(app, '\x1b[B');
    await key(app, '\r');
    assert.deepEqual(opened, ['two']);
    assert.match(app.lastFrame() ?? '', /17\.09\.2026/);
    assert.match(app.lastFrame() ?? '', /Тестовый студент А/);
    await key(app, '\r'); // Only edit the draft, never save merely by opening a pair.
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /2 \/ 4/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    await key(app, '\x1b');
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    await key(app, '\r');
    assert.equal(reads, 2);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('all lessons scroll through a semester in 80×24 and allow viewing a read-only pair', async () => {
  const client = new FakeClient();
  const opened: string[] = [];
  const records = Array.from({ length: 30 }, (_, index) => ({
    ...lesson,
    key: `pair-${index}`,
    id: String(index),
    subject: `Предмет ${index + 1}`,
    status: 'согласовано',
    readOnly: true,
  }));
  client.loadLessons = async () => ({ journal, lessons: records });
  client.loadAttendance = async (target) => {
    opened.push(target.key);
    return {
      students: [],
      editable: false,
      reason: 'Занятие согласовано. БАРС не предоставляет форму редактирования.',
    };
  };
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\r');
    for (let index = 0; index < 5; index++) await key(app, '\x1b[6~');
    const frame = app.lastFrame() ?? '';
    assert.match(frame, /Предмет 30/);
    assert.match(frame, /30 \/ 30/);
    assert.ok(frame.split('\n').length <= 24);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    await key(app, '\r');
    assert.deepEqual(opened, ['pair-29']);
    assert.match(app.lastFrame() ?? '', /не предоставляет форму редактирования/);
    await key(app, '\x13');
    assert.equal(client.calls.length, 0);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /30 \/ 30/);
    await key(app, '\x1b[5~');
    assert.match(app.lastFrame() ?? '', /23 \/ 30/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('all lessons load failures retain the menu and an empty semester remains navigable', async () => {
  const client = new FakeClient();
  let fail = true;
  client.loadLessons = async () => {
    if (fail) throw new Error('БАРС временно не ответил.');
    return { journal, lessons: [] };
  };
  client.loadAttendance = async () => {
    assert.fail('An empty list must not open an attendance form');
  };
  const app = render(<App client={client} />);
  try {
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    assert.match(app.lastFrame() ?? '', /БАРС временно не ответил/);
    fail = false;
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /пока нет пар/);
    await key(app, '\x1b[B');
    await key(app, '\x1b[6~');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /пока нет пар/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('integrity opens from the menu, retries failed reads and preserves the last report without opening attendance', async () => {
  const client = new FakeClient();
  const original = client.loadIntegrity.bind(client);
  let fail = true;
  let checks = 0;
  client.loadLessons = async () => {
    assert.fail('Integrity needs separate source snapshots, not the merged lesson list');
  };
  client.loadAttendance = async () => {
    assert.fail('Checking integrity must not open an attendance form');
  };
  client.loadIntegrity = async (now) => {
    checks++;
    if (fail) throw new Error('Расписание временно недоступно.');
    return original(now);
  };
  const app = render(<App client={client} now={() => new Date('2026-09-18T13:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    assert.match(app.lastFrame() ?? '', /\[\*\] Проверка целостности/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Расписание временно недоступно/);
    fail = false;
    await key(app, '\r');
    await key(app, ' ');
    assert.match(app.lastFrame() ?? '', /БАРС · Целостность/);
    assert.match(app.lastFrame() ?? '', /Готово: 2 \/ 2/);
    assert.match(app.lastFrame() ?? '', /Нарушений: 1/);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 24);
    fail = true;
    await key(app, 'r');
    await key(app, ' ');
    assert.match(app.lastFrame() ?? '', /Расписание временно недоступно/);
    assert.match(app.lastFrame() ?? '', /Готово: 2 \/ 2/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Проверка целостности/);
    assert.equal(checks, 3);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('integrity repair displays live progress, runs once and refreshes the report after verified correction', async () => {
  const client = new FakeClient();
  let repairs = 0;
  let reads = 0;
  let repaired = false;
  let finish!: (result: IntegrityRepairResult) => void;
  client.loadIntegrity = async (now) => {
    reads++;
    return {
      journal,
      checkedAt: now.toISOString(),
      entries: checkIntegrity(
        [lesson],
        [{ ...lesson, type: repaired ? lesson.type : 'практическое занятие' }],
        now,
      ),
    };
  };
  client.repairIntegrityEntry = () => {
    repairs++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const app = render(<App client={client} now={() => new Date('2026-09-18T12:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\r');
    await key(app, ' ');
    assert.match(app.lastFrame() ?? '', /Исправить нарушения/);
    await key(app, '\t');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Исправляем/);
    assert.equal(repairs, 1);
    await key(app, 'f');
    await key(app, '\r');
    assert.equal(repairs, 1);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 24);
    repaired = true;
    finish({ status: 'fixed', message: 'Отметки сохранены.' });
    await delay(100);
    assert.match(app.lastFrame() ?? '', /Исправлено: 1/);
    assert.equal(reads, 2);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /Нарушений: 0/);
    assert.doesNotMatch(app.lastFrame() ?? '', /Исправить нарушения/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('missing records offer attendance input without inventing marks or saving automatically', async () => {
  const client = new FakeClient();
  const missing = { ...lesson, id: null };
  let rosters = 0;
  client.loadIntegrity = async (now) => ({
    journal,
    checkedAt: now.toISOString(),
    entries: checkIntegrity([missing], [], now),
  });
  client.loadLessons = async () => ({ journal, lessons: [missing] });
  client.loadAttendance = async () => {
    rosters++;
    return structuredClone(client.attendance);
  };
  const app = render(<App client={client} now={() => new Date('2026-09-18T12:00:00Z')} />);
  try {
    await enterCredentials(app);
    await key(app, '\x1b[A');
    await key(app, '\x1b[A');
    await key(app, '\r');
    await key(app, ' ');
    await key(app, 'f');
    assert.match(app.lastFrame() ?? '', /Нужно вручную/);
    assert.match(app.lastFrame() ?? '', /Открыть посещаемость/);
    assert.equal(rosters, 0);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /БАРС · Посещаемость/);
    assert.match(app.lastFrame() ?? '', /\[ \] Тестовый студент А/);
    assert.equal(rosters, 1);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('reload offers to discard a draft and restores server attendance after confirmation', async () => {
  const client = new FakeClient();
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await login(app);
    await key(app, ' ');
    await key(app, 'r');
    assert.match(app.lastFrame() ?? '', /Отменить изменения/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[ \] Тестовый студент А/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('long roster fits an 80×24 terminal and scrolls to the final student', async () => {
  const client = new FakeClient();
  client.attendance.students = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    name: `Студент номер ${i + 1}`,
    present: false,
  }));
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await login(app);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 24);
    for (let i = 0; i < 7; i++) await key(app, '\x1b[6~');
    assert.match(app.lastFrame() ?? '', /Студент номер 20/);
    await key(app, ' ');
    await key(app, '\x13');
    assert.deepEqual([...client.calls[0]], ['19']);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('two-factor screen accepts a retry and reaches the menu without resending credentials', async () => {
  const client = new FakeClient();
  let logins = 0;
  const codes: string[] = [];
  const store = new MemoryAuthStore();
  client.login = async () => {
    logins++;
    return { status: 'two-factor', message: 'Логин и пароль приняты. Введи код.' };
  };
  client.verifyTwoFactor = async (code) => {
    codes.push(code);
    return code === '6543'
      ? { status: 'authenticated' }
      : { status: 'two-factor', message: 'Введи код.', error: 'Неверный или просроченный код.' };
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await enterCredentials(app);
    assert.match(app.lastFrame() ?? '', /\[Код\]/);
    assert.doesNotMatch(app.lastFrame() ?? '', /\[Пароль\]/);
    assert.deepEqual(store.credentialWrites, []);
    await key(app, '0000');
    assert.match(app.lastFrame() ?? '', /Неверный или просроченный код/);
    assert.match(app.lastFrame() ?? '', /\[Код\]/);
    assert.deepEqual(store.credentialWrites, []);
    await key(app, '65 43');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(logins, 1);
    assert.deepEqual(codes, ['0000', '6543']);
    assert.deepEqual(store.credentialWrites, [credentials]);
    assert.equal(
      app.frames.some((frame) => /private-password|0000|65 ?43/.test(frame)),
      false,
    );
  } finally {
    app.unmount();
    app.cleanup();
  }
});
test('Escape from the code screen returns to credential input without verifying anything', async () => {
  const client = new FakeClient();
  let verifications = 0;
  const store = new MemoryAuthStore();
  client.login = async () => ({ status: 'two-factor', message: 'Введи код.' });
  client.verifyTwoFactor = async () => {
    verifications++;
    return { status: 'authenticated' };
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await delay(80);
    for (const input of ['test-user', '\r', 'private-password', '\r']) await key(app, input);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[Логин\]/);
    assert.equal(verifications, 0);
    assert.deepEqual(store.credentialWrites, []);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('first login saves credentials; a new launch uses them without typing or rewriting', async () => {
  const store = new MemoryAuthStore();
  const first = render(<App client={new FakeClient()} authStore={store} />);
  try {
    await enterCredentials(first);
    assert.match(first.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.deepEqual(store.credentialWrites, [credentials]);
  } finally {
    first.unmount();
    first.cleanup();
  }
  const second = render(<App client={new FakeClient()} authStore={store} />);
  try {
    await delay(100);
    assert.match(second.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(store.loads, 2);
    assert.deepEqual(store.credentialWrites, [credentials]);
    assert.equal(
      second.frames.some((frame) => /test-user|private-password/.test(frame)),
      false,
    );
  } finally {
    second.unmount();
    second.cleanup();
  }
});

test('automatic login still requests two-factor verification without persisting the code', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  let logins = 0;
  client.login = async (account, password) => {
    logins++;
    assert.deepEqual({ account, password }, credentials);
    return { status: 'two-factor', message: 'Введи код.' };
  };
  client.verifyTwoFactor = async (code) => {
    assert.equal(code, '6543');
    return { status: 'authenticated' };
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /\[Код\]/);
    assert.deepEqual(store.credentialWrites, []);
    await key(app, '6543');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(logins, 1);
    assert.deepEqual(store.credentialWrites, []);
    assert.deepEqual(store.stored, credentials);
    assert.equal(
      app.frames.some((frame) => /test-user|private-password|6543/.test(frame)),
      false,
    );
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('rejected saved credentials return to manual login and update only after success', async () => {
  const old = { account: 'old-user', password: 'expired-password' };
  const store = new MemoryAuthStore(old);
  const client = new FakeClient();
  let logins = 0;
  client.login = async (account, password) => {
    logins++;
    if (account === old.account) throw new Error('БАРС не принял логин или пароль.');
    assert.deepEqual({ account, password }, credentials);
    return { status: 'authenticated' };
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /\[Логин\]/);
    assert.match(app.lastFrame() ?? '', /БАРС не принял/);
    await delay(100);
    assert.equal(logins, 1);
    assert.deepEqual(store.credentialWrites, []);
    assert.deepEqual(store.stored, old);
    await enterCredentials(app);
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(logins, 2);
    assert.deepEqual(store.credentialWrites, [credentials]);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('Keychain failure permits manual login and does not hide a successful authentication', async () => {
  const store = new MemoryAuthStore();
  store.load = async () => {
    throw new Error('Не удалось прочитать Связку ключей. Можно войти вручную.');
  };
  store.save = async () => {
    throw new Error('native failure with private-password');
  };
  const app = render(<App client={new FakeClient()} authStore={store} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /Не удалось прочитать/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[Логин\]/);
    await enterCredentials(app);
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.match(app.lastFrame() ?? '', /Вход выполнен, но сохранить данные/);
    assert.equal(
      app.frames.some((frame) => /private-password|native failure/.test(frame)),
      false,
    );
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('forced manual login bypasses the saved account and retains it after a rejected password', async () => {
  const old = { account: 'old-user', password: 'old-password' };
  const store = new MemoryAuthStore(old);
  const client = new FakeClient();
  client.restoreSession = async () => {
    assert.fail('Forced login must not read the saved session');
  };
  client.login = async () => {
    throw new Error('БАРС не принял логин или пароль.');
  };
  const sessionUnlock: SessionUnlock = {
    unlock: async () => {
      assert.fail('Manual login must not invoke Touch ID');
    },
  };
  const app = render(
    <App client={client} authStore={store} sessionUnlock={sessionUnlock} autoLogin={false} />,
  );
  try {
    await enterCredentials(app);
    assert.match(app.lastFrame() ?? '', /\[Логин\]/);
    assert.match(app.lastFrame() ?? '', /БАРС не принял/);
    assert.equal(store.loads, 0);
    assert.deepEqual(store.credentialWrites, []);
    assert.deepEqual(store.stored, old);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('a valid saved session opens the menu without submitting a password or requesting a code', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  client.restoreSession = async () => ({
    status: 'authenticated',
    profile: { fullName: profileName, roles: ['Студент'] },
  });
  client.login = async () => {
    assert.fail('Must not submit credentials for a valid session');
  };
  client.verifyTwoFactor = async () => {
    assert.fail('Must not request a code for a valid session');
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.match(app.lastFrame() ?? '', /0\.9\.0 alpha/);
    assert.match(app.lastFrame() ?? '', /Тестов Алексей Сергеевич/);
    assert.match(app.lastFrame() ?? '', /Тестов Алексей Сергеевич · Студент ·/);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 24);
    assert.equal(store.loads, 1);
    assert.deepEqual(store.credentialWrites, []);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('a failed session check can be retried without falling back to a new login', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  let checks = 0;
  let unlocks = 0;
  client.restoreSession = async () => {
    if (++checks === 1) throw new Error('БАРС временно не ответил.');
    return { status: 'authenticated' };
  };
  client.login = async () => {
    assert.fail('A timeout is not proof of expiry');
  };
  const sessionUnlock: SessionUnlock = {
    unlock: async () => {
      unlocks++;
      return { status: 'authenticated' };
    },
  };
  const app = render(<App client={client} authStore={store} sessionUnlock={sessionUnlock} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /повторить проверку/);
    assert.equal(store.loads, 1);
    assert.equal(unlocks, 0);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(checks, 2);
    assert.equal(store.loads, 2);
    assert.equal(unlocks, 1);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('Touch ID starts only after session validation and hides all authenticated UI until success', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  const order: string[] = [];
  let restore!: (result: SessionRestoreResult) => void;
  let unlock!: (result: UnlockResult) => void;
  client.restoreSession = () => {
    order.push('session');
    return new Promise((resolve) => {
      restore = resolve;
    });
  };
  client.login = async () => {
    assert.fail('A valid session never needs the saved password');
  };
  client.loadLessons = async () => {
    assert.fail('Attendance is inaccessible before Touch ID');
  };
  const sessionUnlock: SessionUnlock = {
    unlock: () => {
      order.push('touch-id');
      return new Promise((resolve) => {
        unlock = resolve;
      });
    },
  };
  const app = render(<App client={client} authStore={store} sessionUnlock={sessionUnlock} />);
  try {
    await delay(80);
    assert.deepEqual(order, ['session']);
    restore({ status: 'authenticated', profile: { fullName: profileName, roles: ['Студент'] } });
    await delay(80);
    assert.deepEqual(order, ['session', 'touch-id']);
    assert.match(app.lastFrame() ?? '', /Подтверди вход через Touch ID/);
    await key(app, '\r');
    await key(app, '\x1b');
    await key(app, 'r');
    assert.deepEqual(order, ['session', 'touch-id']);
    assert.equal(
      app.frames.some((frame) => frame.includes(profileName) || frame.includes('[*] Посещаемость')),
      false,
    );
    unlock({ status: 'authenticated' });
    await delay(80);
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.ok(app.lastFrame()?.includes(profileName));
    assert.equal(store.loads, 1);
    assert.deepEqual(store.credentialWrites, []);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('cancelling Touch ID keeps the session locked and retry validates it again', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  const order: string[] = [];
  let attempts = 0;
  client.restoreSession = async () => {
    order.push('session');
    return { status: 'authenticated' };
  };
  client.login = async () => {
    assert.fail('Cancellation must not trigger password login');
  };
  const sessionUnlock: SessionUnlock = {
    unlock: async () => {
      order.push('touch-id');
      return { status: ++attempts === 1 ? 'cancelled' : 'authenticated' };
    },
  };
  const app = render(<App client={client} authStore={store} sessionUnlock={sessionUnlock} />);
  try {
    await delay(100);
    assert.match(app.lastFrame() ?? '', /Проверка Touch ID отменена/);
    assert.doesNotMatch(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(store.loads, 1);
    await key(app, 'r');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.deepEqual(order, ['session', 'touch-id', 'session', 'touch-id']);
    assert.equal(store.loads, 2);
    assert.deepEqual(store.credentialWrites, []);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('unavailable, locked, failed or crashing Touch ID only allows an explicit fresh BARS login', async () => {
  for (const failure of ['unavailable', 'locked-out', 'failed', 'setup-error', 'throw'] as const) {
    const store = new MemoryAuthStore(credentials);
    const client = new FakeClient();
    let attempts = 0;
    let logins = 0;
    client.restoreSession = async () => ({
      status: 'authenticated',
      profile: { fullName: profileName, roles: ['Студент'] },
    });
    client.login = async (account, password) => {
      logins++;
      assert.equal(account, credentials.account);
      assert.equal(password, credentials.password);
      return { status: 'two-factor', message: 'Введи код.' };
    };
    const sessionUnlock: SessionUnlock = {
      unlock: async () => {
        attempts++;
        if (failure === 'throw') throw new Error('native private-password');
        return { status: failure };
      },
    };
    const app = render(<App client={client} authStore={store} sessionUnlock={sessionUnlock} />);
    try {
      await delay(100);
      assert.match(app.lastFrame() ?? '', /БАРС · Touch ID/);
      assert.equal(logins, 0);
      assert.equal(store.loads, 1);
      assert.equal(
        app.frames.some(
          (frame) =>
            frame.includes(profileName) ||
            frame.includes('native private-password') ||
            frame.includes('[*] Посещаемость'),
        ),
        false,
      );
      await key(app, '\x1b');
      assert.match(app.lastFrame() ?? '', /\[Логин\]/);
      await enterCredentials(app);
      assert.match(app.lastFrame() ?? '', /\[Код\]/);
      assert.doesNotMatch(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
      await key(app, '0123');
      assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
      assert.equal(logins, 1);
      assert.equal(attempts, 1);
      assert.equal(store.loads, 1);
    } finally {
      app.unmount();
      app.cleanup();
    }
  }
});

test('missing and expired sessions use the existing BARS login flow without Touch ID', async () => {
  for (const status of ['missing', 'expired'] as const) {
    const store = new MemoryAuthStore(credentials);
    const client = new FakeClient();
    let logins = 0;
    client.restoreSession = async () => ({ status });
    client.login = async () => {
      logins++;
      return { status: 'two-factor', message: 'Введи код.' };
    };
    const sessionUnlock: SessionUnlock = {
      unlock: async () => {
        assert.fail('There is no valid session to unlock');
      },
    };
    const app = render(<App client={client} authStore={store} sessionUnlock={sessionUnlock} />);
    try {
      await delay(100);
      assert.match(app.lastFrame() ?? '', /\[Код\]/);
      assert.equal(logins, 1);
      assert.equal(store.loads, 1);
      await key(app, '0123');
      assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    } finally {
      app.unmount();
      app.cleanup();
    }
  }
});

test('closing the TUI aborts the native prompt and ignores its late result', async () => {
  for (const close of ['unmount', 'ctrl-c'] as const) {
    const client = new FakeClient();
    client.restoreSession = async () => ({ status: 'authenticated' });
    let signal!: AbortSignal;
    let unlock!: (result: UnlockResult) => void;
    const sessionUnlock: SessionUnlock = {
      unlock: (attemptSignal) => {
        signal = attemptSignal;
        return new Promise((resolve) => {
          unlock = resolve;
        });
      },
    };
    const app = render(
      <App
        client={client}
        authStore={new MemoryAuthStore(credentials)}
        sessionUnlock={sessionUnlock}
      />,
    );
    try {
      await delay(80);
      assert.equal(signal.aborted, false);
      if (close === 'unmount') app.unmount();
      else await key(app, '\x03');
      assert.equal(signal.aborted, true);
      unlock({ status: 'authenticated' });
      await delay(80);
      assert.equal(
        app.frames.some((frame) => frame.includes('[*] Посещаемость')),
        false,
      );
    } finally {
      app.unmount();
      app.cleanup();
    }
  }
});

test('the fourth digit submits once, preserves a leading zero, and ignores Enter while awaiting the response', async () => {
  const client = new FakeClient();
  const codes: string[] = [];
  let finish!: (result: LoginResult) => void;
  client.login = async () => ({ status: 'two-factor', message: 'Введи код.' });
  client.verifyTwoFactor = (code) => {
    codes.push(code);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const app = render(<App client={client} />);
  try {
    await enterCredentials(app);
    await key(app, '0');
    await key(app, '1');
    await key(app, '2');
    await key(app, '\r');
    assert.deepEqual(codes, []);
    await key(app, '3');
    assert.deepEqual(codes, ['0123']);
    await key(app, '\r');
    await key(app, '4');
    assert.deepEqual(codes, ['0123']);
    finish({ status: 'authenticated' });
    await delay(100);
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(
      app.frames.some((frame) => /0123|private-password/.test(frame)),
      false,
    );
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('expiry during attendance restores login, preserves drafts and never retries the save', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  let checks = 0;
  let saves = 0;
  client.restoreSession = async () => ({ status: ++checks === 1 ? 'authenticated' : 'expired' });
  client.saveAttendance = async () => {
    saves++;
    throw Object.assign(new Error('Сессия истекла.'), { name: 'SessionExpiredError' });
  };
  const app = render(
    <App client={client} authStore={store} now={() => new Date('2026-09-16T11:00:00Z')} />,
  );
  try {
    await delay(100);
    await key(app, '\r');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    await key(app, '\x13');
    await delay(100);
    assert.match(app.lastFrame() ?? '', /Вход восстановлен/);
    assert.equal(saves, 1);
    assert.equal(checks, 2);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    assert.equal(saves, 1);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('manual recovery keeps drafts for the same account and isolates them when switching accounts', async () => {
  const store = new MemoryAuthStore(credentials);
  const client = new FakeClient();
  let checks = 0;
  let saves = 0;
  client.restoreSession = async () => {
    if (++checks === 1)
      return { status: 'authenticated', profile: { account: 'public\\test-user', roles: [] } };
    throw new Error('БАРС временно недоступен.');
  };
  client.login = async (account) => ({
    status: 'authenticated',
    profile: { account: `PUBLIC\\${account.toUpperCase()}`, roles: [] },
  });
  client.saveAttendance = async () => {
    saves++;
    throw Object.assign(new Error('Сессия истекла.'), { name: 'SessionExpiredError' });
  };
  const app = render(
    <App client={client} authStore={store} now={() => new Date('2026-09-16T11:00:00Z')} />,
  );
  try {
    await delay(100);
    await key(app, '\r');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    for (const [account, present] of [
      ['test-user', true],
      ['another-user', false],
      ['test-user', true],
    ] as const) {
      await key(app, '\x13');
      await delay(100);
      assert.match(app.lastFrame() ?? '', /повторить проверку/);
      await key(app, '\x1b');
      await key(app, account);
      await key(app, '\r');
      await key(app, 'test-password');
      await key(app, '\r');
      assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
      await key(app, '\r');
      if (present) assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
      else assert.match(app.lastFrame() ?? '', /\[ \] Тестовый студент А/);
    }
    assert.equal(saves, 3, 'Recovery must never resubmit attendance');
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('weekly schedule opens from the menu, browses weeks and never loads attendance', async () => {
  const client = new FakeClient();
  client.loadLessons = async () => {
    assert.fail('Schedule must use the timetable, not attendance records');
  };
  client.loadAttendance = async () => {
    assert.fail('Opening a schedule must not open attendance forms');
  };
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await enterCredentials(app);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Расписание/);
    await key(app, '\r');
    let frame = app.lastFrame() ?? '';
    assert.match(frame, /БАРС · Расписание\s+ТСТ-01м-25/);
    assert.match(frame, /Неделя 14\.09\.2026 — 20\.09\.2026/);
    assert.match(frame, /Среда · 16\.09\.2026 · сегодня/);
    assert.match(frame, /13:45–15:20 \|\| 3 пара \|\| лекция/);
    assert.match(frame, /Ж-211 \(Корпус КИЖ\) · доц\. Тестовый А\.А\./);
    await key(app, '\x1b[C');
    assert.match(app.lastFrame() ?? '', /Неделя 21\.09\.2026 — 27\.09\.2026/);
    assert.match(app.lastFrame() ?? '', /Пар нет/);
    assert.doesNotMatch(app.lastFrame() ?? '', /Управление ИТ-проектами/);
    await key(app, '\x1b[D');
    await key(app, '\x1b[D');
    await key(app, 't');
    await key(app, 'r');
    assert.deepEqual(client.scheduleDates, [
      '2026-09-14',
      '2026-09-21',
      '2026-09-14',
      '2026-09-07',
      '2026-09-14',
      '2026-09-14',
    ]);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Расписание/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Оценки/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Почта/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Проверка целостности/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Сменить группу/);
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('weekly schedule wraps long subjects in 80×24 and scrolls through Sunday', async () => {
  const client = new FakeClient();
  client.loadSchedule = async () => ({
    groupName: 'ТСТ-01м-25',
    startDate: '2026-09-14',
    endDate: '2026-09-20',
    lessons: [
      {
        ...lesson,
        date: '2026-09-14',
        subject:
          'Очень длинное название учебной дисциплины, которое должно переноситься целиком: последняя часть названия',
        location: 'Ж-211',
        teacher: 'доц. Тестовый А.А.',
      },
    ],
  });
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\r');
    const frame = app.lastFrame() ?? '';
    assert.ok(frame.split('\n').length <= 24);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    assert.match(frame, /последняя часть названия/);
    for (let i = 0; i < 4; i++) await key(app, '\x1b[6~');
    assert.match(app.lastFrame() ?? '', /Воскресенье · 20\.09\.2026/);
    assert.match(app.lastFrame() ?? '', /Esc меню/);
    assert.ok((app.lastFrame() ?? '').split('\n').length <= 24);
    for (let i = 0; i < 4; i++) await key(app, '\x1b[5~');
    assert.match(app.lastFrame() ?? '', /Понедельник · 14\.09\.2026/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('a failed week request retains the displayed dates and permits retry', async () => {
  const client = new FakeClient();
  const load = client.loadSchedule.bind(client);
  let fail = true;
  client.loadSchedule = async (date) => {
    if (fail && weekDates(date).startDate === '2026-09-21')
      throw new Error('БАРС временно не ответил.');
    return load(date);
  };
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\r');
    await key(app, '\x1b[C');
    assert.match(app.lastFrame() ?? '', /Неделя 14\.09\.2026 — 20\.09\.2026/);
    assert.match(app.lastFrame() ?? '', /БАРС временно не ответил/);
    fail = false;
    await key(app, '\x1b[C');
    assert.match(app.lastFrame() ?? '', /Неделя 21\.09\.2026 — 27\.09\.2026/);
    assert.doesNotMatch(app.lastFrame() ?? '', /БАРС временно не ответил/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('grades open from the third menu item and browse semesters without loading attendance', async () => {
  const client = new FakeClient();
  client.loadLessons = async () => {
    assert.fail('Grades must not load attendance');
  };
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Оценки/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /БАРС · Оценки/);
    assert.match(app.lastFrame() ?? '', /2026\/2027, Осенний семестр/);
    assert.match(app.lastFrame() ?? '', /Красный — КМ без оценки/);
    assert.match(app.lastFrame() ?? '', /4,25/);
    await key(app, '[');
    assert.match(app.lastFrame() ?? '', /2025\/2026, Весенний семестр/);
    await key(app, '[');
    assert.match(app.lastFrame() ?? '', /В этом семестре данных об успеваемости нет/);
    await key(app, ']');
    await key(app, 'r');
    assert.deepEqual(client.gradeCalls, ['28', '27', '24', '27', '27']);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Оценки/);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Почта/);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Все пары/);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Проверка целостности/);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Сменить группу/);
    await key(app, '\x1b[B');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('grades fit 80×24, scroll to the final week and reveal KM descriptions on Enter', async () => {
  const client = new FakeClient();
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\t');
    await key(app, '\r');
    let frame = app.lastFrame() ?? '';
    assert.ok(frame.split('\n').length <= 24);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    for (let i = 0; i < 16; i++) await key(app, '\x1b[C');
    frame = app.lastFrame() ?? '';
    assert.match(frame, /Недели \d+–16/);
    assert.match(frame, /4,25/);
    assert.ok(frame.split('\n').length <= 24);
    assert.ok(frame.split('\n').every((line) => line.length <= 80));
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /КМ 1 · оценки нет · КМ-1\. Технологии виртуализации/);
    assert.match(app.lastFrame() ?? '', /Неделя 8 · Оценка: 5/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /Недели \d+–16/);
    await key(app, '\x1b[B');
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Неделя 4 · Оценка: 0/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('failed grade refresh keeps the existing semester and permits retry', async () => {
  const client = new FakeClient();
  const original = client.loadGrades.bind(client);
  let fail = false;
  client.loadGrades = async (semester) => {
    if (fail) throw new Error('БАРС не вернул таблицу оценок.');
    return original(semester);
  };
  const app = render(<App client={client} />);
  try {
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\t');
    await key(app, '\r');
    fail = true;
    await key(app, '[');
    assert.match(app.lastFrame() ?? '', /2026\/2027, Осенний семестр/);
    assert.match(app.lastFrame() ?? '', /не вернул таблицу оценок/);
    fail = false;
    await key(app, '[');
    assert.match(app.lastFrame() ?? '', /2025\/2026, Весенний семестр/);
    assert.doesNotMatch(app.lastFrame() ?? '', /не вернул таблицу оценок/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('mail opens from the main menu using its own gateway and returns without changing BARS or attendance', async () => {
  const client = new FakeClient();
  let listCalls = 0;
  let readCalls = 0;
  client.loadLessons = async () => {
    assert.fail('Mail must not load BARS attendance');
  };
  const mail: MailGateway = {
    loadInbox: async () => {
      listCalls++;
      return parseInbox(inboxHtml());
    },
    loadMessage: async (item) => {
      readCalls++;
      return parseMailMessage(messageHtml(item.id), item);
    },
  };
  const app = render(<App client={client} mail={mail} />);
  try {
    await enterCredentials(app);
    await key(app, '\t');
    await key(app, '\t');
    await key(app, '\t');
    assert.match(app.lastFrame() ?? '', /\[\*\] Почта/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /БАРС · Почта\s+mail.mpei.ru/);
    assert.match(app.lastFrame() ?? '', /Входящие · страница 1 \/ 3/);
    assert.equal(listCalls, 1);
    assert.equal(readCalls, 0);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /Полная тема письма/);
    assert.equal(readCalls, 1);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /Входящие/);
    await key(app, '\x1b');
    assert.match(app.lastFrame() ?? '', /\[\*\] Почта/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('multiple groups show enrollment status, remember a choice and reuse it after restart', async () => {
  const store = new MemoryAuthStore();
  const client = new FakeClient();
  client.groups = structuredClone(studyGroups);
  const app = render(<App client={client} authStore={store} />);
  try {
    Object.defineProperty(app.stdout, 'columns', { value: 80 });
    Object.defineProperty(app.stdout, 'rows', { value: 24 });
    app.stdout.emit('resize');
    await enterCredentials(app);
    const frame = app.lastFrame() ?? '';
    assert.match(frame, /Выбери группу/);
    assert.match(frame, /завершил обучение/);
    assert.match(frame, /обучается/);
    assert.ok(frame.split('\n').length <= 24);
    assert.equal(!!client.selectedGroup, false);
    assert.equal(store.record?.selectedGroup, undefined);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(client.selectedGroup?.id, studyGroups[1].id);
    await key(app, '\x1b[A');
    assert.match(app.lastFrame() ?? '', /\[\*\] Сменить группу/);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /ТСТ-01м-25 · выбрана/);
    await key(app, '\x1b[A');
    await key(app, '\r');
    assert.deepEqual(store.record?.selectedGroup, {
      id: studyGroups[0].id,
      studentId: studyGroups[0].studentId,
    });
  } finally {
    app.unmount();
    app.cleanup();
  }
  const restarted = new FakeClient();
  restarted.groups = structuredClone(studyGroups);
  restarted.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'test-user', roles: ['Студент'] },
  });
  restarted.login = async () => {
    assert.fail('Do not re-enter the saved password');
  };
  const restored = render(<App client={restarted} authStore={store} />);
  try {
    await delay(150);
    assert.match(restored.lastFrame() ?? '', /\[\*\] Посещаемость/);
    assert.equal(restarted.selectedGroup?.id, studyGroups[0].id);
  } finally {
    restored.unmount();
    restored.cleanup();
  }
});

test('switching groups isolates attendance drafts even when lesson and student IDs coincide', async () => {
  const client = new FakeClient();
  client.groups = structuredClone(studyGroups);
  const app = render(<App client={client} now={() => new Date('2026-09-16T11:00:00Z')} />);
  try {
    await enterCredentials(app);
    await key(app, '\r'); // Current enrollment.
    await key(app, '\r'); // Attendance.
    await key(app, '\r'); // Select the first student.
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    await key(app, '\x1b');
    await key(app, '\x1b[A');
    await key(app, '\r');
    await key(app, '\x1b[A');
    await key(app, '\r'); // Old enrollment.
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[ \] Тестовый студент А/);
    await key(app, '\x1b');
    await key(app, '\x1b[A');
    await key(app, '\r');
    await key(app, '\x1b[B');
    await key(app, '\r'); // Return to the current enrollment.
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[x\] Тестовый студент А/);
    assert.equal(client.calls.length, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test('unavailable saved groups prompt a new choice and discovery failures remain retryable', async () => {
  const client = new FakeClient();
  client.groups = structuredClone(studyGroups);
  client.restoreSession = async () => ({
    status: 'authenticated',
    profile: { account: 'test-user', roles: [] },
  });
  const store = new MemoryAuthStore(credentials);
  store.record!.selectedGroup = { id: 'deleted', studentId: 'deleted' };
  let fail = true;
  const load = client.loadGroups.bind(client);
  client.loadGroups = async () => {
    if (fail) throw new Error('Temporary failure');
    return load();
  };
  const app = render(<App client={client} authStore={store} />);
  try {
    await delay(150);
    assert.match(app.lastFrame() ?? '', /Не удалось загрузить группы/);
    assert.equal(!!client.selectedGroup, false);
    fail = false;
    await key(app, 'r');
    assert.match(app.lastFrame() ?? '', /Выбери группу/);
    assert.match(app.lastFrame() ?? '', /завершил обучение/);
    assert.equal(!!client.selectedGroup, false);
    await key(app, '\r');
    assert.match(app.lastFrame() ?? '', /\[\*\] Посещаемость/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
