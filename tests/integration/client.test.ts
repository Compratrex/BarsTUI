import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { BarsClient } from '../../src/infrastructure/bars/bars-client.js';
import { SessionExpiredError } from '../../src/infrastructure/bars/errors.js';
import { AuthService } from '../../src/features/auth/auth-service.js';
import { AttendanceController } from '../../src/features/attendance/attendance-controller.js';
import type { AuthStore, SavedAuth } from '../../src/features/auth/storage.js';
import { gradePage, gradeSemesters } from '../fixtures/grades.js';
import { studentListHtml, studentMainHtml, studyGroups } from '../fixtures/groups.js';
import { profileHtml, profileName } from '../fixtures/profile.js';

class MemoryAuthStore implements AuthStore {
  record: SavedAuth | null = null;
  get stored() {
    return this.record?.session ?? null;
  }
  async load() {
    return structuredClone(this.record);
  }
  async save(record: SavedAuth) {
    this.record = structuredClone(record);
  }
  async clear() {
    const existed = this.record !== null;
    this.record = null;
    return existed;
  }
}

async function selectFixtureGroup(client: BarsClient) {
  const groups = await client.loadGroups();
  client.selectGroup(groups.find((group) => group.studentId === 'fixture-student')!);
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

async function fixture({
  twoFactor = false,
  brokenCodeButton = false,
  dropAfterCode = false,
  consultation = false,
  authStore,
}: {
  twoFactor?: boolean;
  brokenCodeButton?: boolean;
  dropAfterCode?: boolean;
  consultation?: boolean;
  authStore?: AuthStore;
} = {}) {
  const state = {
    created: false,
    writes: 0,
    ignoreWrites: false,
    invalidToken: false,
    alicePresent: true,
    bobPresent: true,
    readonly: false,
    consultationAvailable: true,
    form: new URLSearchParams(),
    loginPosts: 0,
    codePosts: 0,
    journalReads: 0,
    expireCode: false,
    expireSession: false,
    journalStatus: 200,
    hangJournal: false,
    homeStatus: 200,
    hangHome: false,
    groupQueries: [] as string[],
    extraCookie: '',
    codeForm: new URLSearchParams(),
    challengeToken: 'test-code-csrf',
  };
  const timetable = {
    html: null as string | null,
    queries: [] as URLSearchParams[],
    recordReads: 0,
  };
  const metadata = {
    type: consultation ? '4' : '1',
    time: '3',
    bobSkipReason: 1,
    resetOnChange: false,
  };
  const typeLabels: Record<string, string> = {
    '1': 'лекция',
    '2': 'лабораторная работа',
    '4': 'консультации КП/КР',
  };
  const timeLabels: Record<string, string> = {
    '3': '3 пара (13:45-15:20)',
    '4': '4 пара (15:35-17:10)',
  };
  const grades = {
    html: null as string | null,
    hideLink: false,
    requests: [] as { method: string; params: URLSearchParams }[],
  };
  const profile = { status: 200, html: profileHtml, reads: 0, hang: false };
  const login =
    '<form method="post"><input id="Account" name="Account"><input id="Password" name="Password" type="password"><button type="submit" id="btnLogin">Войти</button></form>';
  // Matches the live Bars challenge: hidden Account, no Password, and a separate Auth/LoginCode action.
  const codeForm = () =>
    `<form action="/bars_web/Auth/LoginCode" method="post"><input name="__RequestVerificationToken" type="hidden" value="${state.challengeToken}"><input id="Account" name="Account" type="hidden" value="test-user"><input name="StopOpenDefault" type="hidden" value="False"><input name="RememberMe" type="hidden" value="False"><input id="AF2_Code" name="AF2_Code" type="text" placeholder="Код подтверждения" autocomplete="off"><button type="button" id="btnLogin" onclick="${brokenCodeButton ? "throw new Error('broken handler')" : 'this.form.requestSubmit()'}">Войти</button></form>`;
  const journal =
    '<a href="/bars_web/US/User/EditUser">Профиль пользователя</a><table><tr><td>2026/2027, Осенний семестр</td><td><a href="/bars_web/SG/TrainingJournal/EditTrainingJournal?tjID=23">Открыть</a></td></tr></table>';
  const subject = consultation
    ? 'Технологии разработки программного обеспечения'
    : 'Управление IT-проектами';
  const schedule = `<table><tr><td colspan="2">среда, 16 сентября</td></tr><tr><td>13:45-15:20 3 пара Ж-211 (Корпус КИЖ)</td><td>${consultation ? 'Технология разработки программного обеспечения (Консультация по КР)' : 'Управление ИТ-проектами (Лекция)'} ТСТ-01м-25 доц. Тестовый А.А.</td></tr></table>`;
  const roster = (
    editing: boolean,
  ) => `<ul><li data-as-id="${editing && consultation ? '20' : '10'}" data-show="s">ТСТ-01м-25</li>
    <li data-stud-id="alice" class="${editing && !state.alicePresent ? 'list-group-item-danger' : ''}"><span>Студент А</span></li>
    <li data-stud-id="bob" data-skip-reason="${metadata.bobSkipReason}" class="${editing && !state.bobPresent ? 'list-group-item-danger' : ''}"><span>Студент Б</span>${editing && !state.bobPresent && metadata.bobSkipReason === 2 ? '<span class="badge bg-success">Уважительная</span>' : ''}</li>
  </ul>`;
  const form = (
    editing: boolean,
  ) => `<!doctype html><html><body><div class="modal"><form action="/bars_web/SG/Lesson/${editing ? 'EditLesson?lesID=100' : 'CreateLesson?ownerID=23'}" method="post">
    <input name="__RequestVerificationToken" value="test-csrf" type="hidden"><input id="AttendanceSheetLessonStudentListSerialized" name="AttendanceSheetLessonStudentListSerialized" type="hidden">
    <input id="Date" name="Date" value="16.09.2026"><input name="Theme" value="Оставить прежнюю тему"><textarea name="Comment">Прежний комментарий</textarea>
    <select id="AttendanceSheetID" name="AttendanceSheetID"><option value="10">${subject} (экзамен)</option>${consultation ? `<option value="20" ${editing ? 'selected' : ''}>${subject} (защита КП/КР)</option>` : ''}</select>
    <select id="LessonTypeID" name="LessonTypeID">${Object.entries(typeLabels)
      .filter(([id]) => id !== '4' || consultation)
      .map(
        ([id, label]) =>
          `<option value="${id}" ${editing && metadata.type === id ? 'selected' : ''} ${id === '4' && !state.consultationAvailable ? 'disabled' : ''}>${label}</option>`,
      )
      .join('')}</select>
    <select id="LessonTimeID" name="LessonTimeID">${Object.entries(timeLabels)
      .map(
        ([id, label]) =>
          `<option value="${id}" ${editing && metadata.time === id ? 'selected' : ''}>${label}</option>`,
      )
      .join('')}</select>
    <select id="Lesson_EmployeeID" name="Lesson_EmployeeID" multiple><option value="teacher1" selected>Тестовый А.А.</option><option value="teacher2" selected>Тестовый Б.Б.</option></select>
    <select id="LessonInfoStatusID" name="LessonInfoStatusID"><option value="1">на рассмотрении</option></select>
    <div id="divSkips">${editing ? '' : roster(false)}</div><button type="submit">Сохранить</button></form></div>
    <script>
    ${editing ? `mountFixtureRoster(${JSON.stringify(roster(true))});` : ''}
    document.getElementById('AttendanceSheetID').addEventListener('change', event => {document.querySelector('[data-as-id]').dataset.asId = event.target.value;});
    if (${metadata.resetOnChange}) for (const id of ['LessonTypeID','LessonTimeID']) document.getElementById(id).addEventListener('change', () => {document.getElementById('Lesson_EmployeeID').value=''; for (const row of document.querySelectorAll('[data-stud-id]')) row.classList.remove('list-group-item-danger');});
    function getAttendanceSheetLessonStudentListInfo(){return {AttendanceSheetLessonStudents:[{AttendanceSheetID:document.getElementById('AttendanceSheetID').value,Show:'s',Checked:false,Students:[...document.querySelectorAll('[data-stud-id]')].map(row=>({StudentID:row.dataset.studId,...(row.classList.contains('list-group-item-danger')?{LessonSkipReasonID:Number(row.dataset.skipReason || 1)}:{})}))}]};}</script></body></html>`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (/ListStudyGroup__TrainingJournals/.test(url.pathname)) state.journalReads++;
    if (url.pathname === '/bars_web/' && request.method === 'POST') {
      state.loginPosts++;
      const input = await body(request);
      if (input.get('Account') === 'test-user' && input.get('Password') === 'test-password') {
        if (twoFactor) {
          response.setHeader('set-cookie', 'pending=test; Path=/; HttpOnly');
          response.end(codeForm());
          return;
        }
        response.writeHead(302, {
          'set-cookie': 'session=test; Path=/; HttpOnly',
          location: '/bars_web/home',
        });
        response.end();
      } else
        response.end(
          login + '<div class="validation-summary-errors">БАРС не принял логин или пароль.</div>',
        );
      return;
    }
    if (url.pathname === '/bars_web/Auth/LoginCode' && request.method === 'POST') {
      state.codePosts++;
      const input = await body(request);
      state.codeForm = input;
      if (state.expireCode) {
        response.end(login);
        return;
      }
      if (
        !request.headers.cookie?.includes('pending=test') ||
        input.get('__RequestVerificationToken') !== state.challengeToken ||
        input.get('Account') !== 'test-user'
      ) {
        response.writeHead(403).end('Wrong challenge session');
        return;
      }
      if (input.get('AF2_Code') !== '654321') {
        state.challengeToken = 'refreshed-code-csrf';
        response.end(
          codeForm() + '<div class="field-validation-error">Неверный или просроченный код.</div>',
        );
        return;
      }
      response.writeHead(302, {
        'set-cookie': 'session=test; Path=/; HttpOnly',
        location: dropAfterCode ? '/bars_web/interrupted' : '/bars_web/home',
      });
      response.end();
      return;
    }
    if (url.pathname === '/bars_web/interrupted') {
      response.destroy();
      return;
    }
    if (state.expireSession || !request.headers.cookie?.includes('session=test')) {
      response.end(login);
      return;
    }
    if (url.pathname === '/bars_web/US/User/EditUser') {
      profile.reads++;
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      if (profile.hang) return;
      response.writeHead(profile.status).end(profile.html);
      return;
    }
    if (url.pathname === '/bars_web/ST/Student/ListStudent') {
      response.end(studentListHtml());
      return;
    }
    if (url.pathname === '/bars_web/ST/Student/Main') {
      const group = studyGroups.find(
        (item) => item.studentId === url.searchParams.get('studentID'),
      );
      if (!group) {
        response.writeHead(404).end();
        return;
      }
      response.end(studentMainHtml(group, grades.hideLink));
      return;
    }
    if (/\/ST_Study\/Main\/(Summary|_PartialSummary)$/.test(url.pathname)) {
      grades.requests.push({ method: request.method!, params: url.searchParams });
      if (!studyGroups.some((group) => group.studentId === url.searchParams.get('studentID'))) {
        response.writeHead(400).end('Wrong student');
        return;
      }
      const query = JSON.parse(url.searchParams.get('query') ?? '{}');
      const semesterId = query.FilterSemester?.Value ?? '28';
      if (!gradeSemesters.some((semester) => semester.id === semesterId)) {
        response.writeHead(400).end('Wrong semester');
        return;
      }
      response.end(grades.html ?? gradePage(semesterId));
      return;
    }
    if (/ListStudyGroup__TrainingJournals/.test(url.pathname)) {
      state.groupQueries.push(url.searchParams.get('sgID') ?? '');
      if (state.hangJournal) return;
      if (state.journalStatus !== 200) {
        response.writeHead(state.journalStatus).end('Temporary failure');
        return;
      }
      if (state.extraCookie)
        response.setHeader('set-cookie', `refreshed=${state.extraCookie}; Path=/; HttpOnly`);
      response.end(journal);
      return;
    }
    if (url.pathname.includes('_PartialTimetable')) {
      timetable.queries.push(url.searchParams);
      response.end(timetable.html ?? schedule);
      return;
    }
    if (url.pathname.includes('_PartialListTrainingJournal_Lessons')) {
      timetable.recordReads++;
      response.end(
        `<table id="tbl__PartialListTrainingJournal_Lessons" data-q-page-size="500">${state.created ? `<tr data-les-id="100"><td><label>16.09.26, ${timeLabels[metadata.time]}, ${typeLabels[metadata.type]} (Тестовый А.А.), ${subject} (${consultation ? 'защита КП/КР' : 'экзамен'})</label><span class="badge">${state.readonly ? 'согласовано' : 'на рассмотрении'}</span>${state.readonly ? '' : '<a href="/bars_web/SG/Lesson/EditLesson?lesID=100&uip=tj">Изменить</a>'}</td></tr>` : ''}</table>`,
      );
      return;
    }
    if (url.pathname.includes('EditTrainingJournal')) {
      // The real edit response is a partial view: its roster requires the journal's runtime.
      // Direct navigation to EditLesson must fail to populate it, while opening the modal works.
      response.end(`<!doctype html><html><body>
        <a href="/bars_web/SG/Lesson/CreateLesson?ownerID=23&uip=tj">Добавить</a>
        ${state.created ? '<a id="edit-lesson" href="/bars_web/SG/Lesson/EditLesson?lesID=100&uip=tj">Изменить</a>' : ''}
        <div id="modal-host"></div><script>
          window.mountFixtureRoster = html => { document.getElementById('divSkips').innerHTML = html; };
          document.getElementById('edit-lesson')?.addEventListener('click', async event => {
            event.preventDefault();
            const response = await fetch(event.currentTarget.href);
            const host = document.getElementById('modal-host'); host.innerHTML = await response.text();
            for (const source of host.querySelectorAll('script')) {
              const executable = document.createElement('script'); executable.textContent = source.textContent; source.replaceWith(executable);
            }
          });
        </script></body></html>`);
      return;
    }
    if (/(CreateLesson|EditLesson)/.test(url.pathname)) {
      if (request.method === 'POST') {
        const input = await body(request);
        state.form = input;
        state.writes++;
        if (input.get('__RequestVerificationToken') !== 'test-csrf') {
          state.invalidToken = true;
          response.writeHead(400).end();
          return;
        }
        if (!state.ignoreWrites) {
          const rows = JSON.parse(input.get('AttendanceSheetLessonStudentListSerialized')!)
            .AttendanceSheetLessonStudents[0].Students as {
            StudentID: string;
            LessonSkipReasonID?: number;
          }[];
          state.alicePresent = !rows.find((student) => student.StudentID === 'alice')
            ?.LessonSkipReasonID;
          state.bobPresent = !rows.find((student) => student.StudentID === 'bob')
            ?.LessonSkipReasonID;
          state.created = true;
          metadata.type = input.get('LessonTypeID')!;
          metadata.time = input.get('LessonTimeID')!;
          metadata.bobSkipReason =
            rows.find((student) => student.StudentID === 'bob')?.LessonSkipReasonID ?? 1;
        }
        response.end('{"success":true}');
        return;
      }
      response.end(form(url.pathname.includes('EditLesson')));
      return;
    }
    if (state.hangHome) return;
    if (state.homeStatus !== 200) {
      response.writeHead(state.homeStatus).end('Unavailable');
      return;
    }
    response.end(
      '<a href="/bars_web/US/User/EditUser">Профиль</a>' +
        '<a href="/bars_web/SG/TrainingJournal/ListStudyGroup__TrainingJournals">Журналы</a>' +
        (grades.hideLink
          ? ''
          : '<a href="/bars_web/ST_Study/Main/Summary?studentID=fixture-student">Сводка</a>'),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const newClient = (sessionCheckTimeoutMs?: number) => {
    const client = new BarsClient({
      baseUrl: `http://127.0.0.1:${address.port}/bars_web/`,
      sessionCheckTimeoutMs,
    });
    return { client, auth: new AuthService(client, authStore) };
  };
  const { client, auth } = newClient();
  return {
    state,
    metadata,
    timetable,
    grades,
    profile,
    client,
    auth,
    newClient,
    async close() {
      await auth.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('full login and restored session return fresh account identity without persisting profile secrets', async () => {
  const store = new MemoryAuthStore();
  const { auth, profile, state, newClient, close } = await fixture({
    twoFactor: true,
    authStore: store,
  });
  const restarted = newClient();
  try {
    const challenge = await auth.login('test-user', 'test-password');
    assert.equal(challenge.status, 'two-factor');
    assert.equal(profile.reads, 0);
    const authenticated = await auth.verifyTwoFactor('654321');
    assert.equal(authenticated.status, 'authenticated');
    if (authenticated.status === 'authenticated')
      assert.deepEqual(authenticated.profile, {
        account: 'public\\test-user',
        fullName: profileName,
        roles: ['Студент'],
      });
    assert.doesNotMatch(
      JSON.stringify(authenticated),
      /private-profile|private-totp|private-email/,
    );
    await auth.close();
    profile.html = profileHtml.replaceAll(profileName, 'Обновлённый Алексей Сергеевич');
    const restored = await restarted.auth.restoreSession();
    assert.equal(restored.status, 'authenticated');
    if (restored.status === 'authenticated')
      assert.equal(restored.profile?.fullName, 'Обновлённый Алексей Сергеевич');
    assert.equal(profile.reads, 2);
    assert.equal(state.loginPosts, 1);
    assert.equal(state.codePosts, 1);
    assert.doesNotMatch(JSON.stringify(store.stored), /private-profile|private-totp|private-email/);
  } finally {
    await restarted.auth.close();
    await close();
  }
});

test('unavailable profile does not turn a confirmed session into a failed login', async () => {
  const { client, auth, profile, state, close } = await fixture();
  try {
    profile.status = 503;
    const result = await auth.login('test-user', 'test-password');
    assert.equal(result.status, 'authenticated');
    if (result.status === 'authenticated') {
      assert.equal(result.profile, undefined);
      assert.match(result.warning ?? '', /ФИО и роль/);
    }
    assert.equal(state.loginPosts, 1);
    profile.status = 200;
    await selectFixtureGroup(client);
    assert.equal((await client.loadLessons(new Date('2026-09-16'))).lessons.length, 1);
  } finally {
    await close();
  }
});

test('grade summaries discover the signed-in student and fetch selected semesters using only GET', async () => {
  const { client, auth, state, grades, timetable, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const current = await client.loadGrades();
    assert.equal(current.semester.id, '28');
    assert.equal(current.subjects.length, 2);
    assert.equal(current.subjects[0].weeks[3][0].kind, 'missing');
    const previous = await client.loadGrades('27');
    assert.equal(previous.semester.id, '27');
    assert.equal(previous.subjects[0].weeks[3][0].kind, 'grade');
    const params = grades.requests.at(-1)!.params;
    assert.equal(params.get('studentID'), 'fixture-student');
    assert.deepEqual(JSON.parse(params.get('query')!), {
      ID: 'fixture-student',
      FilterSemester: { Value: '27' },
    });
    assert.equal((await client.loadGrades('24')).subjects.length, 0);
    await assert.rejects(client.loadGrades('unknown'), /семестр больше недоступен/);
    assert.ok(grades.requests.every((item) => item.method === 'GET'));
    assert.equal(state.loginPosts, 1);
    assert.equal(state.writes, 0);
    assert.equal(timetable.recordReads, 0);
  } finally {
    await close();
  }
});

test('grades report unavailable accounts, malformed pages and session expiry without inventing empty grades', async () => {
  const { client, auth, state, grades, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    grades.hideLink = true;
    await assert.rejects(client.loadGrades(), /не найдена сводка оценок студента/);
    grades.hideLink = false;
    grades.html = '<p>Temporary failure</p>';
    await assert.rejects(client.loadGrades(), /не вернул список семестров/);
    grades.html = null;
    state.expireSession = true;
    await assert.rejects(client.loadGrades(), SessionExpiredError);
  } finally {
    await close();
  }
});

test('weekly schedule requests Monday–Sunday and reads timetable metadata without attendance records', async () => {
  const { client, auth, state, timetable, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    state.created = true;
    const week = await client.loadSchedule(new Date('2026-09-16T11:00:00Z'));
    assert.equal(week.startDate, '2026-09-14');
    assert.equal(week.endDate, '2026-09-20');
    assert.equal(week.lessons.length, 1);
    assert.equal(week.lessons[0].subject, 'Управление ИТ-проектами');
    assert.equal(week.lessons[0].location, 'Ж-211 (Корпус КИЖ)');
    assert.equal(week.lessons[0].teacher, 'доц. Тестовый А.А.');
    assert.deepEqual(Object.fromEntries(timetable.queries[0]), {
      rt: '3',
      name: 'ТСТ-01м-25',
      sd: '14.09.2026',
      ed: '20.09.2026',
      st: '2',
    });
    const nextWeek = await client.loadSchedule(new Date('2026-09-20T21:00:00Z'));
    assert.equal(nextWeek.startDate, '2026-09-21');
    assert.equal(nextWeek.lessons.length, 0);
    assert.equal(timetable.queries[1].get('sd'), '21.09.2026');
    assert.equal(timetable.recordReads, 0);
    assert.equal(state.writes, 0);
    state.expireSession = true;
    await assert.rejects(client.loadSchedule(new Date('2026-09-16')), SessionExpiredError);
  } finally {
    await close();
  }
});

test('weekly schedule distinguishes an empty timetable from an unexpected server page', async () => {
  const { client, auth, timetable, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    timetable.html = '<table></table>';
    assert.deepEqual((await client.loadSchedule(new Date('2026-09-16'))).lessons, []);
    // The live empty-week response has these controls and no table or empty-state text.
    timetable.html =
      '<input id="startDate" value="14.09.2026"><input id="endDate" value="20.09.2026"><select id="ddlReciever"><option>ТСТ-01м-25</option></select>';
    assert.deepEqual((await client.loadSchedule(new Date('2026-09-16'))).lessons, []);
    timetable.html = '<p>Temporary error</p>';
    await assert.rejects(client.loadSchedule(new Date('2026-09-16')), /не вернул расписание/);
  } finally {
    await close();
  }
});

test('integrity compares the original timetable and records, observes the end boundary and never writes marks', async () => {
  const { client, auth, state, timetable, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    client.loadAttendance = async () => {
      assert.fail('Integrity must not load individual attendance forms');
    };
    assert.equal(
      (await client.loadIntegrity(new Date('2026-09-16T12:19:59Z'))).entries[0].status,
      'pending',
    );
    assert.equal(
      (await client.loadIntegrity(new Date('2026-09-16T12:20:00Z'))).entries[0].status,
      'violation',
    );
    state.created = true;
    state.readonly = true;
    assert.equal(
      (await client.loadIntegrity(new Date('2026-09-16T12:20:00Z'))).entries[0].status,
      'ok',
    );
    timetable.html =
      '<table><tr><td colspan="2">среда, 16 сентября</td></tr><tr><td>13:45-15:20 3 пара</td><td>Управление ИТ-проектами (Практическое занятие) ТСТ-01м-25 доц. Тестовый А.А.</td></tr></table>';
    const mismatch = await client.loadIntegrity(new Date('2026-09-16T12:20:00Z'));
    assert.equal(mismatch.entries.length, 1);
    assert.equal(mismatch.entries[0].status, 'violation');
    assert.match(mismatch.entries[0].details.join(' '), /Тип:.*Практическое занятие.*лекция/);
    assert.equal(state.writes, 0);
    assert.equal(state.loginPosts, 1);
  } finally {
    await close();
  }
});
test('integrity refuses broken or partially parsed source pages instead of reporting false missing records', async () => {
  const { client, auth, state, timetable, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    state.created = true;
    timetable.html = '<p>Temporary failure</p>';
    await assert.rejects(client.loadIntegrity(new Date('2026-09-16')), /не вернул расписание/);
    timetable.html =
      '<table><tr><td colspan="2">среда, 16 сентября</td></tr><tr><td>13:45-15:20 3 пара</td><td>Неизвестный формат занятия</td></tr></table>';
    await assert.rejects(client.loadIntegrity(new Date('2026-09-16')), /Часть расписания/);
    timetable.html = null;
    state.expireSession = true;
    await assert.rejects(client.loadIntegrity(new Date('2026-09-16')), SessionExpiredError);
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});

test('real browser: login, timetable, create with presence, reload and edit', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const data = await client.loadLessons(new Date('2026-09-16'));
    assert.equal(data.lessons.length, 1);
    const lesson = Object.freeze(data.lessons[0]);
    const initial = await client.loadAttendance(lesson);
    assert.equal(initial.students.length, 2);
    assert.equal(
      initial.students.some((student) => student.present),
      false,
    );
    // Opening another new pair must dismiss the previous modal and never submit it.
    await client.loadAttendance({ ...lesson });
    assert.equal(state.writes, 0);
    const saved = await client.saveAttendance(lesson, initial, new Set(['10:alice']));
    assert.equal(state.writes, 1);
    assert.equal(state.invalidToken, false);
    assert.equal(lesson.id, null);
    assert.equal(saved.lesson.id, '100');
    assert.equal(saved.attendance.students[0].present, true);
    assert.equal(saved.attendance.students[1].present, false);
    assert.deepEqual(state.form.getAll('Lesson_EmployeeID'), ['teacher1', 'teacher2']);
    assert.equal(state.form.get('Theme'), 'Оставить прежнюю тему');
    const edited = await client.saveAttendance(saved.lesson, saved.attendance, new Set(['10:bob']));
    assert.equal(state.writes, 2);
    assert.equal(edited.attendance.students[0].present, false);
    assert.equal(edited.attendance.students[1].present, true);
  } finally {
    await close();
  }
});
test('project consultation creation selects its sheet and verifies the journal alias after saving', async () => {
  const { client, auth, state, close } = await fixture({ consultation: true });
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    assert.equal(lessons.length, 1);
    const original = await client.loadAttendance(lessons[0]);
    assert.equal(original.editable, true);
    assert.deepEqual(
      original.students.map((student) => student.id),
      ['20:alice', '20:bob'],
    );
    assert.equal(
      original.students.some((student) => student.present),
      false,
    );
    assert.equal(state.writes, 0);
    const saved = await client.saveAttendance(lessons[0], original, new Set(['20:alice']));
    assert.equal(state.writes, 1);
    assert.equal(state.form.get('AttendanceSheetID'), '20');
    assert.equal(state.form.get('LessonTypeID'), '4');
    assert.equal(lessons[0].id, null);
    assert.deepEqual(
      saved.attendance.students.map((student) => student.present),
      [true, false],
    );
    const refreshed = await client.loadLessons(new Date('2026-09-16'));
    assert.equal(refreshed.lessons.length, 1);
    assert.equal(refreshed.lessons[0].id, '100');
    assert.equal(refreshed.lessons[0].type, 'консультации КП/КР');
  } finally {
    await close();
  }
});
test('a consultation created in Bars after opening the draft prevents a duplicate despite different type labels', async () => {
  const { client, auth, state, close } = await fixture({ consultation: true });
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    const original = await client.loadAttendance(lessons[0]);
    state.created = true;
    await assert.rejects(
      client.saveAttendance(lessons[0], original, new Set(['20:alice'])),
      /уже появилась/,
    );
    assert.equal(state.writes, 0);
    assert.equal(lessons[0].id, null);
  } finally {
    await close();
  }
});
test('the actual form determines type availability instead of a hard-coded role restriction', async () => {
  const { client, auth, state, close } = await fixture({ consultation: true });
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    state.consultationAvailable = false;
    await assert.rejects(
      client.loadAttendance(lessons[0]),
      /В форме БАРСа.*недоступен тип «Консультация по КР»/,
    );
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});
test('stale attendance is rejected before any write', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    state.created = true;
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    const original = await client.loadAttendance(lessons[0]);
    state.bobPresent = false;
    await assert.rejects(
      client.saveAttendance(lessons[0], original, new Set(['10:alice'])),
      /изменились/,
    );
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});
test('a successful HTTP status is insufficient when readback differs', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    state.created = true;
    state.ignoreWrites = true;
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    const original = await client.loadAttendance(lessons[0]);
    await assert.rejects(client.saveAttendance(lessons[0], original, new Set()), /не подтвердил/);
  } finally {
    await close();
  }
});
test('failed readback reports an unconfirmed save and never submits the marks twice', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const attendance = new AttendanceController(client);
    attendance.activate('public\\test-user');
    const { lessons } = await attendance.loadLessons(new Date('2026-09-16'));
    const lesson = lessons[0];
    await attendance.openLesson(lesson);
    attendance.selectAll();
    const readAttendance = client.loadAttendance.bind(client);
    client.loadAttendance = async () => {
      throw new Error('page.waitForFunction: Timeout 15000ms exceeded.');
    };
    await assert.rejects(attendance.save(), /Отметки отправлены, но проверить результат/);
    assert.equal(state.writes, 1);
    assert.equal(lesson.id, null);
    const diagnostic = JSON.parse(await fs.readFile('.auth/last-attendance-error.json', 'utf8'));
    assert.equal(diagnostic.stage, 'verify');
    assert.equal(diagnostic.submitted, true);
    assert.equal(diagnostic.category, 'timeout');
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      'category',
      'recordedAt',
      'stage',
      'submitted',
    ]);
    client.loadAttendance = readAttendance;
    await attendance.reload(new Date('2026-09-16'));
    assert.equal(attendance.snapshot().lesson?.id, '100');
    const saved = attendance.snapshot().drafts.get(lesson.key)!.original;
    assert.equal(saved.students.filter((student) => student.present).length, 2);
    assert.equal(state.writes, 1);
  } finally {
    await close();
  }
});
test('a newly appeared record prevents duplicate creation and signed-out reads request login', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    await assert.rejects(client.loadGroups(), SessionExpiredError);
    await assert.rejects(auth.login('test-user', 'wrong-password'), /БАРС не принял/);
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    const original = await client.loadAttendance(lessons[0]);
    state.created = true;
    await assert.rejects(
      client.saveAttendance(lessons[0], original, new Set(['10:alice'])),
      /уже появилась/,
    );
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});
test('approved records cannot be overwritten using an earlier editable snapshot', async () => {
  const { client, auth, state, close } = await fixture();
  try {
    state.created = true;
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const { lessons } = await client.loadLessons(new Date('2026-09-16'));
    const original = await client.loadAttendance(lessons[0]);
    state.readonly = true;
    await assert.rejects(
      client.saveAttendance(lessons[0], original, new Set(['10:alice'])),
      /недоступно/,
    );
    assert.equal(state.writes, 0);
    const refreshed = await client.loadLessons(new Date('2026-09-16'));
    const readonly = await client.loadAttendance(refreshed.lessons[0]);
    assert.equal(readonly.editable, false);
    assert.match(readonly.reason!, /согласовано/);
  } finally {
    await close();
  }
});
test('two-factor challenge is recognized before hidden Account; code uses the same session and form token', async () => {
  const { client, auth, state, close } = await fixture({ twoFactor: true });
  try {
    const first = await auth.login('test-user', 'test-password');
    assert.equal(first.status, 'two-factor');
    assert.equal(state.journalReads, 0);
    const rejected = await auth.verifyTwoFactor('000000');
    assert.equal(rejected.status, 'two-factor');
    if (rejected.status === 'two-factor') assert.match(rejected.error!, /Неверный/);
    assert.equal(state.loginPosts, 1);
    assert.equal(state.journalReads, 0);
    const accepted = await auth.verifyTwoFactor('654 321');
    assert.equal(accepted.status, 'authenticated');
    assert.equal(state.loginPosts, 1);
    assert.equal(state.codePosts, 2);
    assert.equal(state.codeForm.get('__RequestVerificationToken'), 'refreshed-code-csrf');
    assert.equal(state.codeForm.get('Account'), 'test-user');
    assert.equal(state.codeForm.has('Password'), false);
    assert.equal(state.codeForm.get('RememberMe'), 'False');
    await selectFixtureGroup(client);
    const data = await client.loadLessons(new Date('2026-09-16'));
    assert.equal(data.lessons.length, 1);
  } finally {
    await close();
  }
});
test('expired and missing challenges request a fresh login instead of submitting code as a password', async () => {
  const { auth, state, close } = await fixture({ twoFactor: true });
  try {
    await assert.rejects(auth.verifyTwoFactor('654321'), SessionExpiredError);
    await auth.login('test-user', 'test-password');
    state.expireCode = true;
    await assert.rejects(auth.verifyTwoFactor('654321'), /Запрос кода истёк/);
    await assert.rejects(auth.verifyTwoFactor('654321'), SessionExpiredError);
    assert.equal(state.codePosts, 1);
    assert.equal(state.loginPosts, 1);
  } finally {
    await close();
  }
});
test('code confirmation works even when the browser button cannot cause a navigation', async () => {
  const { auth, state, close } = await fixture({ twoFactor: true, brokenCodeButton: true });
  try {
    assert.equal((await auth.login('test-user', 'test-password')).status, 'two-factor');
    assert.equal((await auth.verifyTwoFactor('654321')).status, 'authenticated');
    assert.equal(state.codePosts, 1);
    assert.equal(state.loginPosts, 1);
  } finally {
    await close();
  }
});
test('a failed redirect after code acceptance verifies the session without resending the code', async () => {
  const { client, auth, state, close } = await fixture({ twoFactor: true, dropAfterCode: true });
  try {
    await auth.login('test-user', 'test-password');
    assert.equal((await auth.verifyTwoFactor('654321')).status, 'authenticated');
    assert.equal(state.codePosts, 1);
    assert.equal(state.loginPosts, 1);
    await selectFixtureGroup(client);
    assert.equal((await client.loadLessons(new Date('2026-09-16'))).lessons.length, 1);
  } finally {
    await close();
  }
});

test('a session is persisted only after full authentication and reused by a new browser without password or code', async () => {
  const store = new MemoryAuthStore();
  const { client, auth, state, newClient, close } = await fixture({
    twoFactor: true,
    authStore: store,
  });
  const restarted = newClient();
  try {
    assert.equal((await auth.restoreSession()).status, 'missing');
    await auth.login('test-user', 'test-password');
    assert.equal(store.stored, null);
    await auth.verifyTwoFactor('000000');
    assert.equal(store.stored, null);
    await auth.verifyTwoFactor('654321');
    assert.ok(store.stored);
    assert.doesNotMatch(JSON.stringify(store.stored), /654321|test-password|test-code-csrf/);
    await selectFixtureGroup(client);
    state.extraCookie = 'after-use';
    await client.loadLessons(new Date('2026-09-16'));
    await auth.close();
    assert.equal(
      (await store.load())?.session?.cookies.find((cookie) => cookie.name === 'refreshed')?.value,
      'after-use',
    );
    const logins = state.loginPosts;
    const codes = state.codePosts;
    assert.equal((await restarted.auth.restoreSession()).status, 'authenticated');
    await selectFixtureGroup(restarted.client);
    assert.equal((await restarted.client.loadLessons(new Date('2026-09-16'))).lessons.length, 1);
    assert.equal(state.loginPosts, logins);
    assert.equal(state.codePosts, codes);
  } finally {
    await restarted.auth.close();
    await close();
  }
});

test('server-confirmed expiry discards the invalid session and requires a fresh authentication', async () => {
  const store = new MemoryAuthStore();
  const { auth, state, newClient, close } = await fixture({ authStore: store });
  const restarted = newClient();
  try {
    await auth.login('test-user', 'test-password');
    await auth.close();
    state.expireSession = true;
    assert.equal((await restarted.auth.restoreSession()).status, 'expired');
    assert.equal(store.stored, null);
    assert.equal(state.loginPosts, 1);
    state.expireSession = false;
    await restarted.auth.login('test-user', 'test-password');
    assert.equal(state.loginPosts, 2);
    assert.ok(store.stored);
  } finally {
    await restarted.auth.close();
    await close();
  }
});

test('temporary failure during a session probe retains the session and never starts another login', async () => {
  const store = new MemoryAuthStore();
  const { auth, state, newClient, close } = await fixture({ authStore: store });
  const restarted = newClient();
  try {
    await auth.login('test-user', 'test-password');
    await auth.close();
    const saved = await store.load();
    state.homeStatus = 503;
    await assert.rejects(
      restarted.auth.restoreSession(),
      /Не удалось проверить сохранённую сессию/,
    );
    assert.deepEqual(await store.load(), saved);
    assert.equal(state.loginPosts, 1);
    assert.equal(state.codePosts, 0);
    state.homeStatus = 200;
    assert.equal((await restarted.auth.restoreSession()).status, 'authenticated');
    assert.equal(state.loginPosts, 1);
  } finally {
    await restarted.auth.close();
    await close();
  }
});

test(
  'a stalled session probe times out promptly and can retry without losing the saved session',
  { timeout: 6_000 },
  async () => {
    const store = new MemoryAuthStore();
    const { auth, state, newClient, close } = await fixture({ authStore: store });
    const restarted = newClient(1_000);
    try {
      await auth.login('test-user', 'test-password');
      await auth.close();
      const saved = await store.load();
      state.hangHome = true;
      const started = performance.now();
      await assert.rejects(restarted.auth.restoreSession(), /Сессия сохранена/);
      assert.ok(performance.now() - started < 3_000);
      assert.deepEqual(await store.load(), saved);
      assert.equal(state.loginPosts, 1);
      assert.equal(state.codePosts, 0);
      state.hangHome = false;
      assert.equal((await restarted.auth.restoreSession()).status, 'authenticated');
      assert.equal(state.loginPosts, 1);
    } finally {
      await restarted.auth.close();
      await close();
    }
  },
);

test(
  'a stalled profile fits the remaining startup budget and does not block a confirmed login',
  { timeout: 6_000 },
  async () => {
    const store = new MemoryAuthStore();
    const { auth, profile, state, newClient, close } = await fixture({ authStore: store });
    const restarted = newClient(1_000);
    try {
      await auth.login('test-user', 'test-password');
      await auth.close();
      profile.hang = true;
      const started = performance.now();
      const result = await restarted.auth.restoreSession();
      assert.ok(performance.now() - started < 2_500);
      assert.equal(result.status, 'authenticated');
      if (result.status === 'authenticated') {
        assert.deepEqual(result.profile, { account: 'public\\test-user', roles: [] });
        assert.match(result.warning ?? '', /ФИО и роль/);
      }
      assert.ok(await store.load());
      assert.equal(state.loginPosts, 1);
      assert.equal(state.codePosts, 0);
      profile.hang = false;
      const refreshed = await restarted.auth.restoreSession();
      if (refreshed.status === 'authenticated')
        assert.equal(refreshed.profile?.fullName, profileName);
      else assert.fail('The profile timeout must not invalidate the session');
    } finally {
      await restarted.auth.close();
      await close();
    }
  },
);

test('session persistence errors warn without invalidating an authenticated login', async () => {
  const store = new MemoryAuthStore();
  store.save = async () => {
    throw new Error('native secret-cookie error');
  };
  const { client, auth, close } = await fixture({ authStore: store });
  try {
    const result = await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    assert.equal(result.status, 'authenticated');
    if (result.status === 'authenticated') {
      assert.match(result.warning!, /сохранить данные входа и сессию/);
      assert.doesNotMatch(result.warning!, /secret-cookie/);
    }
    assert.equal((await client.loadLessons(new Date('2026-09-16'))).lessons.length, 1);
  } finally {
    await close();
  }
});

test('integrity repair changes type and time but preserves roster, excused absences and other form fields', async () => {
  const { client, auth, state, metadata, close } = await fixture();
  try {
    state.created = true;
    state.bobPresent = false;
    metadata.type = '2';
    metadata.time = '4';
    metadata.bobSkipReason = 2;
    metadata.resetOnChange = true;
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const now = new Date('2026-09-17');
    const report = await client.loadIntegrity(now);
    const entry = report.entries[0];
    assert.equal(entry.status, 'violation');
    const before = structuredClone(entry);
    const result = await client.repairIntegrityEntry(entry, now);
    assert.equal(result.status, 'fixed');
    assert.equal(state.writes, 1);
    assert.equal(state.form.get('LessonTypeID'), '1');
    assert.equal(state.form.get('LessonTimeID'), '3');
    assert.equal(state.form.get('Theme'), 'Оставить прежнюю тему');
    assert.equal(state.form.get('Comment'), 'Прежний комментарий');
    assert.deepEqual(state.form.getAll('Lesson_EmployeeID'), ['teacher1', 'teacher2']);
    assert.equal(state.form.get('AttendanceSheetID'), '10');
    assert.equal(state.form.get('LessonInfoStatusID'), '1');
    assert.equal(state.form.get('Date'), '16.09.2026');
    assert.equal(state.invalidToken, false);
    assert.equal(state.alicePresent, true);
    assert.equal(state.bobPresent, false);
    assert.equal(metadata.bobSkipReason, 2);
    assert.deepEqual(entry, before);
    assert.equal((await client.loadIntegrity(now)).entries[0].status, 'ok');
    assert.equal((await client.repairIntegrityEntry(entry, now)).status, 'fixed');
    assert.equal(state.writes, 1);
  } finally {
    await close();
  }
});

test('integrity repair rejects stale reports and skips records that became read-only', async () => {
  const { client, auth, state, metadata, close } = await fixture();
  try {
    state.created = true;
    metadata.type = '2';
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const now = new Date('2026-09-17');
    const entry = (await client.loadIntegrity(now)).entries[0];
    metadata.time = '4';
    await assert.rejects(client.repairIntegrityEntry(entry, now), /изменилась после проверки/);
    assert.equal(state.writes, 0);
    state.readonly = true;
    assert.equal((await client.repairIntegrityEntry(entry, now)).status, 'manual');
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});

test('ignored integrity changes are not reported as fixed', async () => {
  const { client, auth, state, metadata, close } = await fixture();
  try {
    state.created = true;
    metadata.type = '2';
    state.ignoreWrites = true;
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const now = new Date('2026-09-17');
    const entry = (await client.loadIntegrity(now)).entries[0];
    await assert.rejects(client.repairIntegrityEntry(entry, now), /не подтвердил исправление/);
    assert.equal(state.writes, 1);
    assert.equal((await client.loadIntegrity(now)).entries[0].status, 'violation');
  } finally {
    await close();
  }
});

test('failed integrity readback reports uncertainty and a fresh check avoids resending the correction', async () => {
  const { client, auth, state, metadata, close } = await fixture();
  try {
    state.created = true;
    metadata.type = '2';
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const now = new Date('2026-09-17');
    const entry = (await client.loadIntegrity(now)).entries[0];
    client.loadAttendance = async () => {
      throw new Error('page.waitForFunction: Timeout');
    };
    await assert.rejects(client.repairIntegrityEntry(entry, now), /Результат не подтверждён/);
    assert.equal(state.writes, 1);
    assert.equal((await client.repairIntegrityEntry(entry, now)).status, 'fixed');
    assert.equal(state.writes, 1);
  } finally {
    await close();
  }
});

test('integrity repair does not move a roster to another journal sheet', async () => {
  const { client, auth, state, timetable, close } = await fixture({ consultation: true });
  try {
    state.created = true;
    timetable.html =
      '<table><tr><td colspan="2">среда, 16 сентября</td></tr><tr><td>13:45-15:20 3 пара Ж-211</td><td>Технология разработки программного обеспечения (Лекция) ТСТ-01м-25 доц. Тестовый А.А.</td></tr></table>';
    await auth.login('test-user', 'test-password');
    await selectFixtureGroup(client);
    const now = new Date('2026-09-17');
    const entry = (await client.loadIntegrity(now)).entries[0];
    assert.equal(entry.status, 'violation');
    const result = await client.repairIntegrityEntry(entry, now);
    assert.equal(result.status, 'manual');
    assert.match(result.message, /другой лист/);
    assert.equal(state.writes, 0);
  } finally {
    await close();
  }
});

test('groups are discovered from own enrollments, and all group-specific reads follow the selection', async () => {
  const { client, auth, state, timetable, grades, profile, close } = await fixture();
  try {
    state.journalStatus = 403; // Authentication and discovery must not require headman rights.
    assert.equal((await auth.login('test-user', 'test-password')).status, 'authenticated');
    const groups = await client.loadGroups();
    assert.deepEqual(groups, studyGroups);
    assert.equal(state.journalReads, 0);
    await assert.rejects(client.loadGrades(), /Сначала выбери группу/);
    assert.throws(
      () => client.selectGroup({ id: 'unrelated', studentId: 'stranger' }),
      /недоступна/,
    );
    state.journalStatus = 200;
    for (const group of groups) {
      client.selectGroup(group);
      const week = await client.loadSchedule(new Date('2026-09-16'));
      assert.equal(week.groupName, group.name);
      assert.equal(timetable.queries.at(-1)!.get('name'), group.name);
      await client.loadGrades();
      assert.equal(grades.requests.at(-1)!.params.get('studentID'), group.studentId);
      await client.loadLessons(new Date('2026-09-16'));
      assert.equal(state.groupQueries.at(-1), group.id);
    }
    assert.equal(state.writes, 0);
    // The enrollment disappears between refreshes: the previous choice must stop working.
    profile.html = profileHtml.replace(
      /<span><a[^>]+studentID=fixture-student[^<]+<\/a><\/span>/,
      '',
    );
    assert.deepEqual(await client.loadGroups(), [studyGroups[0]]);
    await assert.rejects(client.loadSchedule(new Date()), /Сначала выбери группу/);
    assert.throws(() => client.selectGroup(studyGroups[1]), /недоступна/);
  } finally {
    await close();
  }
});
