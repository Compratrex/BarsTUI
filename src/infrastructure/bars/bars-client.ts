import type { Page } from 'playwright';
import { load } from 'cheerio';
import fs from 'node:fs/promises';
import type {
  Attendance,
  BarsDataClient,
  SavedAttendance,
  GradesSummary,
  IntegrityEntry,
  IntegrityRepairResult,
  IntegrityReport,
  Journal,
  Lesson,
  WeekSchedule,
  StudyGroup,
  StudyGroupSelection,
} from '../../domain/models.js';
import type { AuthGateway } from '../../features/auth/contracts.js';
import type { SessionState } from '../../features/auth/storage.js';
import { clean, lessonKey, normalize, normalizeLessonType } from '../../domain/lesson-identity.js';
import { mergeLessons, parseHeadmanLessons, parseJournals, parseTimetable } from './parsers.js';
import { displayDate, selectJournal, weekDates } from '../../domain/time.js';
import { parseGradeSemesters, parseGradesSummary } from './grades-parser.js';
import { checkIntegrity, sameIntegrityLesson } from '../../features/integrity/integrity.js';
import { planIntegrityRepair } from '../../features/integrity/integrity-repair.js';
import { BarsSession } from './session.js';
import { loadAccountGroups } from './group-directory.js';
import { sameGroup } from '../../features/groups/selection.js';
import { SessionExpiredError } from './errors.js';
import type { BarsClientOptions } from './options.js';
import {
  attendancePayload,
  selectAttendanceSheet,
  sameAttendance,
  type FormOption,
  type FormSnapshot,
} from './attendance-form.js';

type SaveProgress = {
  stage: 'precheck' | 'open-form' | 'prepare-payload' | 'submit' | 'find-created' | 'verify';
  submitted: boolean;
};

export class BarsClient implements BarsDataClient, AuthGateway {
  private readonly session: BarsSession;
  private groups: StudyGroup[] = [];
  private selectedGroup: StudyGroup | null = null;

  async loadGroups(): Promise<StudyGroup[]> {
    const groups = await loadAccountGroups(this.session);
    this.groups = groups;
    if (this.selectedGroup)
      this.selectedGroup = groups.find((group) => sameGroup(group, this.selectedGroup!)) ?? null;
    return groups.map((group) => ({ ...group }));
  }
  selectGroup(choice: StudyGroupSelection) {
    const group = this.groups.find((item) => sameGroup(item, choice));
    if (!group) throw new Error('Выбранная группа больше недоступна. Обнови список групп.');
    this.selectedGroup = group;
  }
  clearGroup() {
    this.selectedGroup = null;
    this.groups = [];
  }
  private get group(): StudyGroup {
    if (!this.selectedGroup) throw new Error('Сначала выбери группу.');
    return this.selectedGroup;
  }
  private get journalsUrl() {
    return this.session.url(
      `SG/TrainingJournal/ListStudyGroup__TrainingJournals?sgID=${encodeURIComponent(this.group.id)}`,
    );
  }

  constructor(options: BarsClientOptions = {}) {
    this.session = new BarsSession(options);
  }

  login(account: string, password: string) {
    this.clearGroup();
    return this.session.login(account, password);
  }
  verifyTwoFactor(code: string) {
    return this.session.verifyTwoFactor(code);
  }
  restoreSession(state?: SessionState) {
    this.clearGroup();
    return this.session.restoreSession(state);
  }
  captureSession() {
    return this.session.captureSession();
  }
  close() {
    return this.session.close();
  }

  private async recordedLessons(journalId: string): Promise<Lesson[]> {
    const all: Lesson[] = [];
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      const query = {
        ID: journalId,
        State: null,
        SortOrder: null,
        Page: String(pageNumber),
        PageSize: '500',
        SearchText: '',
        FilterStartDate: '',
        FilterEndDate: '',
        DisplayModeFilter: { Value: 'LIS_1;LIS_2;LIS_3;LT_1;LT_2;LT_3;LT_4;1;' },
      };
      const url = new URL(this.session.url('SG/Lesson/_PartialListTrainingJournal_Lessons'));
      url.searchParams.set('tjID', journalId);
      url.searchParams.set('query', JSON.stringify(query));
      const html = await this.session.getHtml(url.href);
      const $ = load(html);
      if (!$('#tbl__PartialListTrainingJournal_Lessons').length)
        throw new Error('Не удалось прочитать список занятий БАРСа.');
      const rows = parseHeadmanLessons(html, journalId);
      if ($('tr[data-les-id]').length !== rows.length)
        throw new Error('Формат занятий БАРСа изменился: часть записей не удалось прочитать.');
      const fresh = rows.filter((lesson) => !all.some((existing) => existing.key === lesson.key));
      all.push(...fresh);
      const pageSize =
        Number($('#tbl__PartialListTrainingJournal_Lessons').attr('data-q-page-size')) || 500;
      if (rows.length < pageSize) return all;
      if (!fresh.length) throw new Error('БАРС повторил страницу занятий. Загрузка остановлена.');
    }
    throw new Error('Слишком много страниц занятий в журнале.');
  }
  private timetableUrl(startDate: string, endDate: string): string {
    const url = new URL(this.session.url('Open/RUZ/_PartialTimetable'));
    for (const [key, value] of Object.entries({
      rt: '3',
      name: this.group.name,
      sd: displayDate(startDate),
      ed: displayDate(endDate),
      st: '2',
    }))
      url.searchParams.set(key, value);
    return url.href;
  }
  async loadSchedule(date: Date): Promise<WeekSchedule> {
    const range = weekDates(date);
    const html = await this.session.getHtml(this.timetableUrl(range.startDate, range.endDate));
    const $ = load(html);
    // Empty weeks contain the timetable controls but omit the table altogether.
    const timetableControls =
      $('#startDate').length && $('#endDate').length && $('#ddlReciever').length;
    if (!$('table').length && !timetableControls)
      throw new Error('БАРС не вернул расписание. Попробуй обновить неделю.');
    const lessons = parseTimetable(html, this.group.name, { id: '', ...range });
    lessons.sort(
      (left, right) =>
        `${left.date}T${left.start}`.localeCompare(`${right.date}T${right.start}`) ||
        left.subject.localeCompare(right.subject, 'ru'),
    );
    return { groupName: this.group.name, ...range, lessons };
  }
  async loadGrades(semesterId?: string): Promise<GradesSummary> {
    const home = await this.session.getHtml(
      this.session.url(`ST/Student/Main?studentID=${encodeURIComponent(this.group.studentId)}`),
    );
    const $ = load(home);
    const href = $('a[href*="/ST_Study/Main/Summary"]').first().attr('href');
    if (!href) throw new Error('Для этого аккаунта не найдена сводка оценок студента.');
    const summaryUrl = new URL(href, this.session.baseUrl);
    if (summaryUrl.origin !== new URL(this.session.baseUrl).origin)
      throw new Error('Адрес сводки оценок БАРСа изменился.');
    const studentId = summaryUrl.searchParams.get('studentID');
    if (studentId !== this.group.studentId)
      throw new Error('Сводка оценок не соответствует выбранной учебной записи.');
    // The enrollment home also has a semester selector, but its summary is loaded separately.
    const summaryHtml = await this.session.getHtml(summaryUrl.href);
    const { semesters, selectedId } = parseGradeSemesters(summaryHtml);
    const semester = semesters.find((item) => item.id === (semesterId ?? selectedId));
    if (!semester) throw new Error('Выбранный семестр больше недоступен. Открой оценки заново.');
    let html = summaryHtml;
    if (semester.id !== selectedId || !load(summaryHtml)('#tableMarkSummary').length) {
      const url = new URL(this.session.url('ST_Study/Main/_PartialSummary'));
      url.searchParams.set('studentID', studentId);
      url.searchParams.set(
        'query',
        JSON.stringify({ ID: studentId, FilterSemester: { Value: semester.id } }),
      );
      html = await this.session.getHtml(url.href);
    }
    return parseGradesSummary(html, semester, semesters);
  }
  private async lessonSources(now: Date, strict = false) {
    const journals = parseJournals(
      await this.session.getHtml(this.journalsUrl),
      this.session.baseUrl,
    );
    const journal = selectJournal(journals, now);
    const [html, recorded] = await Promise.all([
      this.session.getHtml(this.timetableUrl(journal.startDate, journal.endDate)),
      this.recordedLessons(journal.id),
    ]);
    const $ = load(html);
    const controls = $('#startDate').length && $('#endDate').length && $('#ddlReciever').length;
    if (!$('table').length && !controls)
      throw new Error('БАРС не вернул расписание. Сверка невозможна.');
    const schedule = parseTimetable(html, this.group.name, journal);
    if (strict) {
      const rows = $('tr')
        .toArray()
        .filter((row) => /\d+\s*пара/i.test($(row).find('td,th').first().text()));
      if (
        rows.length !== schedule.length ||
        (!rows.length && !controls && clean($('table').text()))
      ) {
        throw new Error(
          'Часть расписания не удалось прочитать. Проверка целостности не выполнена.',
        );
      }
    }
    return { journal, schedule, recorded };
  }
  async loadLessons(now: Date): Promise<{ journal: Journal; lessons: Lesson[] }> {
    const { journal, schedule, recorded } = await this.lessonSources(now);
    return { journal, lessons: mergeLessons(schedule, recorded) };
  }
  async loadIntegrity(now: Date): Promise<IntegrityReport> {
    const { journal, schedule, recorded } = await this.lessonSources(now, true);
    return {
      journal,
      checkedAt: now.toISOString(),
      entries: checkIntegrity(schedule, recorded, now),
    };
  }
  async repairIntegrityEntry(entry: IntegrityEntry, now: Date): Promise<IntegrityRepairResult> {
    let submitted = false;
    try {
      const plan = planIntegrityRepair(entry);
      if (plan.kind === 'manual') return { status: 'manual', message: plan.reason };
      // Re-check both sources before every write: a previous report is not authority to overwrite newer data.
      const sources = await this.lessonSources(now, true);
      const matches = checkIntegrity(sources.schedule, sources.recorded, now).filter(
        (item) => item.source === 'schedule' && sameIntegrityLesson(item.lesson, entry.lesson),
      );
      if (matches.length !== 1)
        throw new Error(
          'Расписание изменилось или пара неоднозначна. Повтори проверку целостности.',
        );
      const fresh = matches[0];
      if (fresh.status === 'ok')
        return { status: 'fixed', message: 'Запись уже соответствует расписанию.' };
      const latest = planIntegrityRepair(fresh);
      if (latest.kind === 'manual') return { status: 'manual', message: latest.reason };
      const record = latest.record;
      if (record.id !== plan.record.id || !sameIntegrityLesson(record, plan.record))
        throw new Error('Запись изменилась после проверки. Обнови результаты перед исправлением.');
      const page = await this.openForm(record);
      const attendance = await this.readAttendance(page);
      if (!attendance.editable || !attendance.students.length)
        throw new Error('Не удалось прочитать редактируемую посещаемость. Запись не изменена.');
      const snapshot = await this.snapshot(page);
      const payload = new URLSearchParams(snapshot.fields);
      if (payload.get('Date') !== displayDate(record.date))
        throw new Error('Дата в форме изменилась. Повтори проверку целостности.');
      const sheets = await this.formOptions(page, '#AttendanceSheetID');
      if (selectAttendanceSheet(sheets, record).value !== payload.get('AttendanceSheetID'))
        throw new Error('Лист журнала в форме изменился. Запись не изменена.');
      if (selectAttendanceSheet(sheets, fresh.lesson).value !== payload.get('AttendanceSheetID'))
        return {
          status: 'manual',
          message: 'Для пары нужен другой лист журнала. Проверь его и отметки вручную в БАРСе.',
        };
      for (const field of [
        {
          selector: '#LessonTypeID',
          name: 'LessonTypeID',
          before: record.type,
          after: fresh.lesson.type,
          normalize: normalizeLessonType,
        },
        {
          selector: '#LessonTimeID',
          name: 'LessonTimeID',
          before: `${record.pair} пара (${record.start}-${record.end})`,
          after: `${fresh.lesson.pair} пара (${fresh.lesson.start}-${fresh.lesson.end})`,
          normalize,
        },
      ]) {
        const options = await this.formOptions(page, field.selector);
        const current = options.find((option) => option.value === payload.get(field.name));
        if (!current || field.normalize(current.text) !== field.normalize(field.before))
          throw new Error('Тип или время в форме изменились. Повтори проверку целостности.');
        if (field.normalize(field.before) === field.normalize(field.after)) continue;
        const targets = options.filter(
          (option) =>
            !option.disabled && field.normalize(option.text) === field.normalize(field.after),
        );
        if (targets.length !== 1 || !(await page.locator(field.selector).isEnabled()))
          return {
            status: 'manual',
            message: `БАРС не позволяет выбрать «${field.after}» в этой записи.`,
          };
        payload.set(field.name, targets[0].value);
      }
      // Change only metadata values in the existing form. Firing change handlers could reset the roster or teachers.
      payload.set(
        'AttendanceSheetLessonStudentListSerialized',
        JSON.stringify({ AttendanceSheetLessonStudents: snapshot.groups }),
      );
      if (new URL(snapshot.action).origin !== new URL(this.session.baseUrl).origin)
        throw new Error('Форма сохранения ведёт за пределы БАРСа.');
      submitted = true;
      const response = await page.request.post(snapshot.action, {
        data: payload.toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
          referer: page.url(),
        },
        timeout: 30_000,
      });
      if (response.status() === 401) {
        this.session.expire();
      }
      if (!response.ok()) throw new Error(`БАРС вернул HTTP ${response.status()} при исправлении.`);
      const html = await response.text();
      this.session.checkHtml(html);
      const validation = clean(
        load(html)('.field-validation-error, .validation-summary-errors, .alert-danger').text(),
      );
      if (validation) throw new Error(validation);
      const saved = (await this.recordedLessons(record.journalId)).find(
        (item) => item.id === record.id,
      );
      if (!saved || !sameIntegrityLesson(saved, fresh.lesson))
        throw new Error('БАРС не подтвердил исправление типа и времени.');
      const verified = await this.loadAttendance(saved);
      const verifiedForm = await this.snapshot(page);
      const rosterSignature = (form: FormSnapshot) =>
        form.groups
          .flatMap((group) =>
            group.Students.map((student) =>
              JSON.stringify([
                group.AttendanceSheetID,
                student.StudentID,
                student.LessonSkipReasonID ?? null,
              ]),
            ),
          )
          .sort()
          .join('|');
      if (
        !sameAttendance(attendance, verified) ||
        rosterSignature(snapshot) !== rosterSignature(verifiedForm)
      )
        throw new Error('После исправления изменились отметки студентов. Проверь пару в БАРСе.');
      return {
        status: 'fixed',
        message: 'Тип и время совпадают с расписанием. Отметки студентов сохранены.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const safe = /locator\.|apiRequestContext\.|page\.|browserType\.|Timeout|net::/.test(message)
        ? 'БАРС не ответил вовремя при исправлении.'
        : message || 'Не удалось исправить запись.';
      const result = submitted
        ? `${safe} Результат не подтверждён — повтори проверку целостности перед новой попыткой.`
        : safe;
      if (error instanceof SessionExpiredError) throw new SessionExpiredError(result);
      throw new Error(result);
    }
  }
  private async formOptions(page: Page, selector: string): Promise<FormOption[]> {
    return page.locator(`${selector} option`).evaluateAll((items) =>
      items.map((option) => ({
        value: (option as HTMLOptionElement).value,
        text: option.textContent ?? '',
        disabled: option.matches(':disabled'),
      })),
    );
  }
  private async choose(
    page: Page,
    selector: string,
    value: string,
    normalizeValue = normalize,
  ): Promise<void> {
    const options = await this.formOptions(page, selector);
    const matches = options.filter(
      (option) => !option.disabled && normalizeValue(option.text) === normalizeValue(value),
    );
    if (!matches.length && selector === '#LessonTypeID')
      throw new Error(`В форме БАРСа для выбранного листа недоступен тип «${value}».`);
    if (matches.length !== 1) throw new Error(`В БАРСе не найден однозначный вариант «${value}».`);
    await page.locator(selector).selectOption(matches[0].value);
  }
  private async openForm(lesson: Lesson): Promise<Page> {
    const page = await this.session.start();
    // Navigating to the same journal URL only changes its hash and leaves the previous modal open.
    await page.goto('about:blank');
    await page.goto(
      this.session.url(`SG/TrainingJournal/EditTrainingJournal?tjID=${lesson.journalId}#Lessons`),
      { waitUntil: 'domcontentloaded' },
    );
    this.session.checkHtml(await page.content());
    if (lesson.id) {
      // EditLesson returns a partial view. Its roster needs the journal's shared scripts
      // (including jQuery); opening the partial as a page leaves divSkips empty.
      const id = encodeURIComponent(lesson.id);
      await page
        .locator(`a[href*="EditLesson?lesID=${id}&"], a[href$="EditLesson?lesID=${id}"]`)
        .first()
        .click();
      await page.locator('.modal #Date').waitFor();
    } else {
      await page.locator(`a[href*="CreateLesson?ownerID=${lesson.journalId}"]`).first().click();
      await page.locator('.modal #Date').waitFor();
      const options = await page.locator('#AttendanceSheetID option').evaluateAll((items) =>
        items.map((option) => ({
          value: (option as HTMLOptionElement).value,
          text: option.textContent ?? '',
          disabled: option.matches(':disabled'),
        })),
      );
      const sheet = selectAttendanceSheet(options, lesson);
      await page.locator('#AttendanceSheetID').selectOption(sheet.value);
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(
        (id) =>
          document.querySelector('#divSkips li[data-as-id]')?.getAttribute('data-as-id') === id,
        sheet.value,
      );
      await this.choose(page, '#LessonTypeID', lesson.type, normalizeLessonType);
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(
        () =>
          !!document.querySelector<HTMLSelectElement>('#Lesson_EmployeeID')?.selectedOptions.length,
      );
      await page.locator('#Date').fill(displayDate(lesson.date));
      await page.locator('#Date').dispatchEvent('change');
      await this.choose(
        page,
        '#LessonTimeID',
        `${lesson.pair} пара (${lesson.start}-${lesson.end})`,
      );
      await this.choose(page, '#LessonInfoStatusID', 'на рассмотрении');
    }
    await page.waitForFunction(() => !!document.querySelector('#divSkips ul'));
    return page;
  }
  private async readAttendance(page: Page, isNew = false): Promise<Attendance> {
    const students = await page.locator('#divSkips ul li[data-stud-id]').evaluateAll((rows) =>
      rows.map((row) => {
        const sheetId = row
          .parentElement!.querySelector('[data-as-id]')!
          .getAttribute('data-as-id');
        const name =
          [...row.querySelectorAll(':scope > span')].find(
            (span) => !span.classList.contains('badge'),
          )?.textContent ?? '';
        const present = !row.classList.contains('list-group-item-danger');
        return {
          id: `${sheetId}:${row.getAttribute('data-stud-id')}`,
          name,
          present,
          skipReason: present ? undefined : row.querySelector('.badge.bg-success') ? 2 : 1,
        };
      }),
    );
    const submit = page
      .locator('form')
      .filter({ has: page.locator('#divSkips') })
      .locator('[type="submit"]');
    const editable = (await submit.count()) > 0 && (await submit.first().isEnabled());
    return {
      students: students.map((student) => ({
        ...student,
        name: clean(student.name),
        ...(isNew ? { present: false, skipReason: undefined } : {}),
      })),
      editable,
      ...(!editable ? { reason: 'БАРС не разрешает редактировать это занятие.' } : {}),
    };
  }
  async loadAttendance(lesson: Lesson): Promise<Attendance> {
    if (lesson.readOnly)
      return {
        students: [],
        editable: false,
        reason: `Занятие ${lesson.status || 'закрыто'}. БАРС не предоставляет форму редактирования.`,
      };
    return this.readAttendance(await this.openForm(lesson), !lesson.id);
  }
  private async snapshot(page: Page): Promise<FormSnapshot> {
    return page
      .locator('form')
      .filter({ has: page.locator('#divSkips') })
      .evaluate((form) => {
        const getInfo = (
          window as unknown as {
            getAttendanceSheetLessonStudentListInfo?: () => {
              AttendanceSheetLessonStudents: FormSnapshot['groups'];
            };
          }
        ).getAttendanceSheetLessonStudentListInfo;
        if (!getInfo) throw new Error('Не найден обработчик посещаемости БАРСа.');
        return {
          action: (form as HTMLFormElement).action,
          fields: [...new FormData(form as HTMLFormElement).entries()].map(
            ([key, value]) => [key, String(value)] as [string, string],
          ),
          groups: getInfo().AttendanceSheetLessonStudents,
        };
      });
  }
  async saveAttendance(
    lesson: Lesson,
    original: Attendance,
    selected: Set<string>,
  ): Promise<SavedAttendance> {
    const progress: SaveProgress = { stage: 'precheck', submitted: false };
    try {
      return await this.saveAndVerifyAttendance(lesson, original, selected, progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const category = /Timeout|timeout/i.test(message)
        ? 'timeout'
        : /net::|ENOTFOUND|ECONN/.test(message)
          ? 'network'
          : error instanceof SessionExpiredError
            ? 'expired-session'
            : 'unexpected-response';
      // No roster, form values, tokens, URLs or raw error messages are written to disk.
      await fs.mkdir('.auth', { recursive: true }).catch(() => {});
      await fs
        .writeFile(
          '.auth/last-attendance-error.json',
          JSON.stringify({ ...progress, category, recordedAt: new Date().toISOString() }, null, 2),
          { mode: 0o600 },
        )
        .catch(() => {});
      if (error instanceof SessionExpiredError && progress.submitted) {
        throw new SessionExpiredError(
          'Сессия истекла после отправки отметок. Войди снова и проверь эту пару: сохранение не подтверждено.',
        );
      }
      if (/locator\.|apiRequestContext\.|page\.|browserType\.|Timeout|net::/.test(message)) {
        throw new Error(
          progress.submitted
            ? 'Отметки отправлены, но проверить результат в БАРСе не удалось. Нажми R, чтобы перечитать пару и проверить сохранение.'
            : 'Не удалось подготовить сохранение. Отметки не отправлены; выбор сохранён в черновике. Попробуй ещё раз.',
        );
      }
      throw error;
    }
  }
  private async saveAndVerifyAttendance(
    lesson: Lesson,
    original: Attendance,
    selected: Set<string>,
    progress: SaveProgress,
  ): Promise<SavedAttendance> {
    if (!original.editable || lesson.readOnly)
      throw new Error('Эта пара недоступна для редактирования.');
    const wasNew = !lesson.id;
    const records = await this.recordedLessons(lesson.journalId);
    if (wasNew) {
      const matches = records.filter(
        (record) => lessonKey(record) === lessonKey(lesson) && record.start === lesson.start,
      );
      if (matches.length) {
        // A previous submission may have succeeded even if its response was lost. Never create a duplicate.
        if (matches.length !== 1)
          throw new Error('Найдено несколько записей этой пары. Обнови список занятий.');
        throw new Error(
          'В журнале уже появилась запись этой пары. Вернись в меню и открой посещаемость заново.',
        );
      }
    } else {
      const record = records.find((record) => record.id === lesson.id);
      if (!record || record.readOnly)
        throw new Error(
          'Занятие удалено или больше недоступно для редактирования. Обнови список пар.',
        );
      if (
        lessonKey(record) !== lessonKey(lesson) ||
        record.start !== lesson.start ||
        record.end !== lesson.end
      )
        throw new Error(
          'Дата, время или предмет занятия изменились в БАРСе. Обнови список пар перед сохранением.',
        );
    }
    progress.stage = 'open-form';
    const page = await this.openForm(lesson);
    const latest = await this.readAttendance(page, wasNew);
    if (!latest.editable) throw new Error('БАРС больше не разрешает редактировать это занятие.');
    if (!sameAttendance(original, latest))
      throw new Error(
        'Список или отметки изменились в БАРСе. Обнови пару перед сохранением; изменения не отправлены.',
      );
    progress.stage = 'prepare-payload';
    const snapshot = await this.snapshot(page);
    const payload = attendancePayload(snapshot, latest, selected);
    if (new URL(snapshot.action).origin !== new URL(this.session.baseUrl).origin)
      throw new Error('Форма сохранения ведёт за пределы БАРСа.');
    let response;
    progress.stage = 'submit';
    progress.submitted = true;
    try {
      response = await page.request.post(snapshot.action, {
        data: payload.toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
          referer: page.url(),
        },
        timeout: 30_000,
      });
    } catch {
      throw new Error(
        'Ответ на сохранение не получен. Открой посещаемость заново и проверь отметки перед повтором.',
      );
    }
    if (!response.ok())
      throw new Error(
        `БАРС вернул HTTP ${response.status()} при сохранении. Обнови пару и проверь результат.`,
      );
    const html = await response.text();
    this.session.checkHtml(html);
    const $ = load(html);
    const validation = clean(
      $('.field-validation-error, .validation-summary-errors, .alert-danger').text(),
    );
    if (validation) throw new Error(validation);
    if (wasNew) {
      progress.stage = 'find-created';
      const matches = (await this.recordedLessons(lesson.journalId)).filter(
        (record) => lessonKey(record) === lessonKey(lesson) && record.start === lesson.start,
      );
      if (matches.length !== 1 || !matches[0].id)
        throw new Error(
          'Не удалось подтвердить создание пары. Обнови список перед повторной попыткой.',
        );
      lesson = {
        ...lesson,
        id: matches[0].id,
        status: matches[0].status,
        readOnly: matches[0].readOnly,
      };
    }
    progress.stage = 'verify';
    const saved = await this.loadAttendance(lesson);
    if (
      saved.students.length !== latest.students.length ||
      saved.students.some(
        (student) =>
          !latest.students.some((before) => before.id === student.id) ||
          student.present !== selected.has(student.id),
      )
    )
      throw new Error('БАРС не подтвердил все отметки. Обнови пару и проверь результат.');
    return { lesson: { ...lesson }, attendance: saved };
  }
}
