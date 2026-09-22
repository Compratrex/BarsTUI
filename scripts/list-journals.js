import { loadAccountGroups } from '../src/infrastructure/bars/group-directory.ts';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const AUTH_FILE = '.auth/bars-storage.json';
const BASE_URL = 'https://bars.mpei.ru/bars_web/';
let GROUP_NAME;
let JOURNALS_URL;
let TIMETABLE_URL;
const PARTIAL_TIMETABLE_URL = 'https://bars.mpei.ru/bars_web/Open/RUZ/_PartialTimetable';

class TimetableStore {
  constructor() {
    this.data = null;
  }

  save({ groupName, journal, semesterRange, lessons }) {
    this.data = {
      groupName,
      journal,
      semesterRange,
      lessons,
      headmanLessons: [],
      savedAt: new Date().toISOString(),
    };
  }

  saveHeadmanLessons(headmanLessons) {
    if (!this.data) {
      throw new Error('Нельзя сохранить записи старосты без выбранного журнала.');
    }

    this.data.headmanLessons = headmanLessons;
  }

  get lessonsCount() {
    return this.data?.lessons.length || 0;
  }

  get headmanLessonsCount() {
    return this.data?.headmanLessons.length || 0;
  }

  get daysCount() {
    if (!this.data) {
      return 0;
    }

    return new Set(this.data.lessons.map((lesson) => lesson.day)).size;
  }
}

async function ensureAuthState() {
  try {
    await fs.access(AUTH_FILE);
  } catch {
    throw new Error(`Не найдена сохраненная сессия ${AUTH_FILE}. Сначала выполни: npm run login`);
  }
}

function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomDelay(minMs = 200, maxMs = 300) {
  return wait(Math.floor(minMs + Math.random() * (maxMs - minMs + 1)));
}

async function extractJournals(page) {
  return page.evaluate(() => {
    const clean = (value) => value.replace(/\s+/g, ' ').trim();
    const isServiceTitle = (title) => /^Учебные журналы$/i.test(title);
    const seen = new Set();
    const journals = [];

    const addJournal = (title, href) => {
      if (!title || isServiceTitle(title) || seen.has(`${title}|${href || ''}`)) {
        return;
      }

      seen.add(`${title}|${href || ''}`);
      journals.push({ title, href: href || null });
    };

    for (const row of document.querySelectorAll('table tbody tr, table tr')) {
      const link = row.querySelector(
        [
          'a[href*="EditTrainingJournal?tjID="]',
          'a[href*="EditTrainingJournal"][href*="tjID="]',
          'a[href*="edittrainingjournal?tjid="]',
          'a[href*="edittrainingjournal"][href*="tjid="]',
        ].join(', '),
      );

      if (!link) {
        continue;
      }

      const cells = [...row.querySelectorAll('td')]
        .map((cell) => clean(cell.textContent || ''))
        .filter(Boolean)
        .filter((text) => !/^(Открыть|Просмотр|Редактировать|Подробнее)$/i.test(text));
      const title = cells.find((text) => !isServiceTitle(text));

      addJournal(title || clean(link.textContent || ''), link.href);
    }

    if (journals.length > 0) {
      return journals;
    }

    for (const link of document.querySelectorAll(
      [
        'a[href*="EditTrainingJournal?tjID="]',
        'a[href*="EditTrainingJournal"][href*="tjID="]',
        'a[href*="edittrainingjournal?tjid="]',
        'a[href*="edittrainingjournal"][href*="tjid="]',
      ].join(', '),
    )) {
      const title = clean(link.textContent || '');
      addJournal(title, link.href);
    }

    return journals;
  });
}

function printJournals(journals, title = 'Найденные журналы') {
  console.log(`\n${title}:\n`);

  journals.forEach((journal, index) => {
    console.log(`${index + 1}. ${journal.title}`);
  });
}

async function askJournalChoice(journals, prompt = 'Номер журнала') {
  const rl = readline.createInterface({ input, output });

  while (true) {
    const answer = cleanText(await rl.question(`\n${prompt}: `));
    const selectedIndex = Number(answer) - 1;

    if (Number.isInteger(selectedIndex) && journals[selectedIndex]) {
      rl.close();
      return journals[selectedIndex];
    }

    console.log(`Введи число от 1 до ${journals.length}.`);
  }
}

async function askYesNo(question) {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = normalizeComparableText(await rl.question(`${question} (yes/no): `));

    return answer === 'yes' || answer === 'y' || answer === 'да' || answer === 'д';
  } finally {
    rl.close();
  }
}

function getSemesterRange(journalTitle) {
  const match = journalTitle.match(/^(\d{4})\/(\d{4}),\s*(Осенний|Весенний)\s+семестр$/i);

  if (!match) {
    throw new Error(`Не понял семестр из названия журнала: ${journalTitle}`);
  }

  const [, firstYear, secondYear, semesterName] = match;
  const normalizedSemesterName = semesterName.toLowerCase();

  if (normalizedSemesterName === 'весенний') {
    return {
      label: `${journalTitle}: 01.02.${secondYear} - 01.07.${secondYear}`,
      startDate: `01.02.${secondYear}`,
      endDate: `01.07.${secondYear}`,
    };
  }

  return {
    label: `${journalTitle}: 01.09.${firstYear} - 31.12.${firstYear}`,
    startDate: `01.09.${firstYear}`,
    endDate: `31.12.${firstYear}`,
  };
}

function getTrainingJournalId(journal) {
  const match = journal.href?.match(/[?&]tjID=(\d+)/i);

  if (!match) {
    throw new Error(`Не нашел tjID в ссылке журнала: ${journal.href || journal.title}`);
  }

  return match[1];
}

async function fetchTimetableHtml(page, semesterRange) {
  const url = new URL(PARTIAL_TIMETABLE_URL);
  url.searchParams.set('rt', '3');
  url.searchParams.set('name', GROUP_NAME);
  url.searchParams.set('sd', semesterRange.startDate);
  url.searchParams.set('ed', semesterRange.endDate);
  url.searchParams.set('st', '2');

  const response = await page.request.get(url.toString(), {
    headers: {
      referer: TIMETABLE_URL,
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!response.ok()) {
    throw new Error(`Не удалось получить расписание: HTTP ${response.status()}`);
  }

  return response.text();
}

async function fetchHeadmanLessonsHtml(page, trainingJournalId) {
  const query = {
    ID: trainingJournalId,
    State: null,
    SortOrder: null,
    Page: '1',
    PageSize: '500',
    SearchText: '',
    FilterStartDate: '',
    FilterEndDate: '',
    DisplayModeFilter: {
      Value: 'LIS_1;LIS_2;LIS_3;LT_1;LT_2;LT_3;LT_4;1;',
    },
  };
  const url = new URL(
    'https://bars.mpei.ru/bars_web/SG/Lesson/_PartialListTrainingJournal_Lessons',
  );

  url.searchParams.set('tjID', trainingJournalId);
  url.searchParams.set('query', JSON.stringify(query));

  const response = await page.request.get(url.toString(), {
    headers: {
      referer: `https://bars.mpei.ru/bars_web/SG/TrainingJournal/EditTrainingJournal?tjID=${trainingJournalId}#Lessons`,
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!response.ok()) {
    throw new Error(`Не удалось получить записи старосты: HTTP ${response.status()}`);
  }

  return response.text();
}

async function parseTimetable(page, html) {
  return page.evaluate(
    ({ sourceHtml, groupName }) => {
      const clean = (value) => value.replace(/\s+/g, ' ').trim();
      const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const groupPattern =
        /(?:[А-ЯA-Z]{1,5}-?\d[\dА-ЯA-Zа-яa-z,-]*-\d{2}|[А-ЯA-Z]{1,5}-?\d[\dА-ЯA-Zа-яa-z,-]*)/;
      const teacherPattern = /(?:проф\.|доц\.|ассист\.|ст\.преп\.|преп\.)/i;
      const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
      const lessons = [];
      let currentDay = null;

      for (const row of doc.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll('th,td')].map((cell) =>
          clean(cell.textContent || ''),
        );

        if (cells.length === 1 && cells[0]) {
          currentDay = cells[0];
          continue;
        }

        if (cells.length < 2 || !currentDay) {
          continue;
        }

        const [slot, details] = cells;

        if (!slot || !details) {
          continue;
        }

        const subject =
          clean(
            details
              .split(new RegExp(`\\s+${escapeRegExp(groupName)}(?:\\s|$)`))[0]
              .split(groupPattern)[0]
              .split(teacherPattern)[0],
          ) || details;

        lessons.push({
          day: currentDay,
          slot,
          subject,
          details,
        });
      }

      return lessons;
    },
    { sourceHtml: html, groupName: GROUP_NAME },
  );
}

async function parseHeadmanLessons(page, html) {
  return page.evaluate((sourceHtml) => {
    const clean = (value) => value.replace(/\s+/g, ' ').trim();
    const parseLessonTitle = (title) => {
      const match = title.match(
        /^(\d{2}\.\d{2}\.\d{2}),\s*([^()]+?)\s*\(([^)]+)\),\s*([^()]+?)\s*\(([^)]*)\),\s*(.+)$/u,
      );

      if (!match) {
        return { raw: title };
      }

      const [, date, pair, time, type, teachers, subject] = match;

      return {
        raw: title,
        date,
        pair: pair.trim(),
        pairNumber: pair.match(/\d+/)?.[0] || '',
        time,
        type: type.trim(),
        teachers: teachers
          .split(';')
          .map((teacher) => clean(teacher))
          .filter(Boolean),
        subject: clean(subject),
      };
    };
    const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const lessons = [];

    for (const row of doc.querySelectorAll('tr')) {
      const editLink = row.querySelector('a[href*="EditLesson?lesID="]');
      const deleteLink = row.querySelector('a[href*="DeleteLesson?lesID="]');
      const label = row.querySelector('label');
      const title = clean(label?.textContent || '');

      if (!title || !/^\d{2}\.\d{2}\.\d{2},/.test(title)) {
        continue;
      }

      const lessonId = editLink?.getAttribute('href')?.match(/[?&]lesID=(\d+)/i)?.[1] || null;
      const status = clean(row.querySelector('.badge')?.textContent || '');
      const attendance = [...row.querySelectorAll('.ls-header')]
        .map((element) => clean(element.textContent || ''))
        .filter(Boolean);

      lessons.push({
        id: lessonId,
        deleteHref: deleteLink?.getAttribute('href') || null,
        title,
        ...parseLessonTitle(title),
        status,
        attendance,
      });
    }

    return lessons;
  }, html);
}

function parseRussianScheduleDate(dayTitle, semesterRange) {
  const monthNumbers = new Map([
    ['января', 1],
    ['февраля', 2],
    ['марта', 3],
    ['апреля', 4],
    ['мая', 5],
    ['июня', 6],
    ['июля', 7],
    ['августа', 8],
    ['сентября', 9],
    ['октября', 10],
    ['ноября', 11],
    ['декабря', 12],
  ]);
  const match = dayTitle.match(/,\s*(\d{1,2})\s+([а-я]+)/i);

  if (!match) {
    return null;
  }

  const [, day, monthName] = match;
  const month = monthNumbers.get(monthName.toLowerCase());

  if (!month) {
    return null;
  }

  const [, , , startYear] = semesterRange.startDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const [, , , endYear] = semesterRange.endDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const year = month >= 9 ? startYear : endYear;

  return [
    String(Number(day)).padStart(2, '0'),
    String(month).padStart(2, '0'),
    year.slice(-2),
  ].join('.');
}

function normalizeComparableText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,]+$/g, '')
    .trim();
}

function normalizeLessonType(value) {
  const normalizedType = normalizeComparableText(value);

  if (normalizedType.includes('консультац')) {
    return 'консультация';
  }

  return normalizedType;
}

function canManageLessonType(type) {
  const normalizedType = normalizeComparableText(type);
  const unmanagedTypeMarkers = ['консультац', 'экзамен', 'зачет', 'зачёт', 'защита'];

  return !unmanagedTypeMarkers.some((marker) => normalizedType.includes(marker));
}

function shouldCountInStudyPlan(type) {
  const normalizedType = normalizeComparableText(type);

  if (normalizedType.includes('консультац') && normalizedType.includes('кр')) {
    return true;
  }

  return canManageLessonType(type);
}

function splitScheduleSubject(subject) {
  const match = subject.match(/^(.*?)\s*\(([^()]*)\)\s*$/);

  if (!match) {
    return {
      subjectName: cleanText(subject),
      type: '',
    };
  }

  return {
    subjectName: cleanText(match[1]),
    type: cleanText(match[2]),
  };
}

function stripSubjectControlForm(subject) {
  return cleanText(subject.replace(/\s*\(.+$/u, ''));
}

function buildLessonCompareKey({ date, time, subjectName, type }) {
  return [
    date,
    normalizeComparableText(time),
    normalizeComparableText(subjectName),
    normalizeLessonType(type),
  ].join('|');
}

function buildLessonBaseKey({ date, pairNumber, subjectName }) {
  return [date, pairNumber, normalizeComparableText(subjectName)].join('|');
}

function incrementCounter(counter, key) {
  counter.set(key, (counter.get(key) || 0) + 1);
}

function decrementCounter(counter, key) {
  const currentValue = counter.get(key) || 0;

  if (currentValue <= 1) {
    counter.delete(key);
    return;
  }

  counter.set(key, currentValue - 1);
}

function getHeadmanLessonDiff(semesterRange, scheduleLessons, headmanLessons) {
  const headmanKeyCounts = new Map();
  const headmanByBaseKey = new Map();
  const headmanComparableLessons = [];
  const expectedSheetByKey = new Map();

  for (const lesson of headmanLessons) {
    if (!lesson.date || !lesson.time || !lesson.pairNumber || !lesson.subject || !lesson.type) {
      continue;
    }

    const subjectName = stripSubjectControlForm(lesson.subject);
    const comparableLesson = {
      ...lesson,
      subjectName,
      key: buildLessonCompareKey({
        date: lesson.date,
        time: lesson.time,
        subjectName,
        type: lesson.type,
      }),
      baseKey: buildLessonBaseKey({
        date: lesson.date,
        pairNumber: lesson.pairNumber,
        subjectName,
      }),
    };

    if (canManageLessonType(lesson.type)) {
      headmanComparableLessons.push(comparableLesson);
      incrementCounter(headmanKeyCounts, comparableLesson.key);
    }

    const key = buildLessonBaseKey({
      date: lesson.date,
      pairNumber: lesson.pairNumber,
      subjectName,
    });

    if (!headmanByBaseKey.has(key)) {
      headmanByBaseKey.set(key, []);
    }

    headmanByBaseKey.get(key).push(lesson);
  }

  const missingLessons = [];
  const editableTypeMismatches = [];
  const expectedKeyCounts = new Map();

  const expectedLessons = scheduleLessons
    .map((lesson) => {
      const date = parseRussianScheduleDate(lesson.day, semesterRange);
      const time = lesson.slot.match(/\d{2}:\d{2}-\d{2}:\d{2}/)?.[0] || '';
      const pairNumber = lesson.slot.match(/(\d+) пара/)?.[1] || '';
      const { subjectName, type } = splitScheduleSubject(lesson.subject);

      return {
        date,
        time,
        pairNumber,
        day: lesson.day,
        slot: lesson.slot,
        subject: subjectName,
        type,
        sheetName: getExpectedAttendanceSheetName({ subject: subjectName, type }),
        key: buildLessonCompareKey({ date, time, subjectName, type }),
        baseKey: buildLessonBaseKey({ date, pairNumber, subjectName }),
      };
    })
    .filter(
      (lesson) =>
        lesson.date &&
        lesson.time &&
        lesson.pairNumber &&
        lesson.subject &&
        lesson.type &&
        canManageLessonType(lesson.type),
    );

  for (const lesson of expectedLessons) {
    incrementCounter(expectedKeyCounts, lesson.key);

    if ((headmanKeyCounts.get(lesson.key) || 0) > 0) {
      decrementCounter(headmanKeyCounts, lesson.key);
      continue;
    }

    const sameLessonDifferentType = headmanByBaseKey.get(lesson.baseKey) || [];

    if (sameLessonDifferentType.length === 0) {
      missingLessons.push(lesson);
      continue;
    }

    const editableMismatch = sameLessonDifferentType.find(
      (headmanLesson) =>
        normalizeComparableText(headmanLesson.status) !== 'согласовано' &&
        normalizeLessonType(headmanLesson.type) !== normalizeLessonType(lesson.type),
    );

    if (editableMismatch) {
      editableTypeMismatches.push({
        date: lesson.date,
        subject: lesson.subject,
        expectedType: lesson.type,
        currentType: editableMismatch.type,
        status: editableMismatch.status,
        id: editableMismatch.id,
      });
    }
  }

  const extraHeadmanLessons = [];
  const wrongSheetLessons = [];
  const remainingExpectedKeyCounts = new Map(expectedKeyCounts);

  for (const lesson of expectedLessons) {
    if (!expectedSheetByKey.has(lesson.key)) {
      expectedSheetByKey.set(lesson.key, []);
    }

    expectedSheetByKey.get(lesson.key).push(lesson.sheetName);
  }

  for (const lesson of headmanComparableLessons) {
    if ((remainingExpectedKeyCounts.get(lesson.key) || 0) > 0) {
      const expectedSheets = expectedSheetByKey.get(lesson.key) || [];
      const expectedSheet = expectedSheets.shift();

      if (
        expectedSheet &&
        normalizeComparableText(expectedSheet) !== normalizeComparableText(lesson.subject)
      ) {
        wrongSheetLessons.push({
          date: lesson.date,
          subject: stripSubjectControlForm(lesson.subject),
          type: lesson.type,
          currentSheet: lesson.subject,
          expectedSheet,
          status: lesson.status,
          id: lesson.id,
          deleteHref: lesson.deleteHref,
          canDelete:
            normalizeComparableText(lesson.status) === 'на рассмотрении' &&
            Boolean(lesson.deleteHref),
        });
      }

      decrementCounter(remainingExpectedKeyCounts, lesson.key);
      continue;
    }

    extraHeadmanLessons.push({
      date: lesson.date,
      subject: lesson.subjectName,
      type: lesson.type,
      status: lesson.status,
      id: lesson.id,
      deleteHref: lesson.deleteHref,
      canDelete:
        normalizeComparableText(lesson.status) === 'на рассмотрении' && Boolean(lesson.deleteHref),
    });
  }

  return {
    missingLessons,
    editableTypeMismatches,
    extraHeadmanLessons,
    wrongSheetLessons,
    expectedManageableCount: expectedLessons.length,
    headmanManageableCount: headmanComparableLessons.length,
  };
}

function printHeadmanLessonDiff({
  missingLessons,
  editableTypeMismatches,
  extraHeadmanLessons,
  wrongSheetLessons,
  expectedManageableCount,
  headmanManageableCount,
}) {
  console.log(
    `\nПроверка количества управляемых занятий: расписание ${expectedManageableCount}, староста ${headmanManageableCount}`,
  );

  console.log(`\nНе хватает записей старосты: ${missingLessons.length}`);

  if (missingLessons.length > 0) {
    console.log('');

    missingLessons.forEach((lesson, index) => {
      console.log(`${index + 1}. ${lesson.date} | ${lesson.subject} | ${lesson.type}`);
    });
  }

  console.log(`\nМожно исправить тип у несогласованных записей: ${editableTypeMismatches.length}`);

  if (editableTypeMismatches.length > 0) {
    console.log('');

    editableTypeMismatches.forEach((lesson, index) => {
      console.log(
        `${index + 1}. ${lesson.date} | ${lesson.subject} | ${lesson.currentType} -> ${lesson.expectedType} | ${lesson.status}`,
      );
    });
  }

  console.log(`\nЛишние управляемые записи старосты: ${extraHeadmanLessons.length}`);

  if (extraHeadmanLessons.length > 0) {
    console.log('');

    extraHeadmanLessons.forEach((lesson, index) => {
      const status = lesson.status ? ` | ${lesson.status}` : '';
      const action = lesson.canDelete ? ' | можно убрать' : ' | нельзя убрать автоматически';
      console.log(
        `${index + 1}. ${lesson.date} | ${lesson.subject} | ${lesson.type}${status}${action}`,
      );
    });
  }

  console.log(`\nЗаписи не в том листе журнала: ${wrongSheetLessons.length}`);

  if (wrongSheetLessons.length > 0) {
    console.log('');

    wrongSheetLessons.forEach((lesson, index) => {
      const action = lesson.canDelete
        ? ' | можно переоформить'
        : ' | нельзя переоформить автоматически';
      console.log(
        `${index + 1}. ${lesson.date} | ${lesson.subject} | ${lesson.type} | сейчас: ${lesson.currentSheet} | должно быть: ${lesson.expectedSheet}${action}`,
      );
    });
  }
}

function fullYearDate(shortDate) {
  const [day, month, year] = shortDate.split('.');

  return `${day}.${month}.20${year}`;
}

function expectedLessonTypeForForm(type) {
  const normalizedType = normalizeComparableText(type);

  if (normalizedType.includes('консультация')) {
    return 'консультации КП/КР';
  }

  return normalizedType;
}

async function setSelectByText(page, selector, text, { contains = false } = {}) {
  return page.evaluate(
    ({ selector: selectSelector, text: optionText, contains: useContains }) => {
      const clean = (value) => value.replace(/\s+/g, ' ').trim();
      const normalize = (value) => clean(value).toLowerCase().replace(/ё/g, 'е');
      const select = document.querySelector(selectSelector);

      if (!select) {
        throw new Error(`Не найден select ${selectSelector}`);
      }

      const expected = normalize(optionText);
      const option = [...select.options].find((item) => {
        const actual = normalize(item.textContent);
        return useContains ? actual.includes(expected) : actual === expected;
      });

      if (!option) {
        throw new Error(`Не найден вариант "${optionText}" в ${selectSelector}`);
      }

      if (select.value === option.value) {
        return { text: clean(option.textContent), value: option.value };
      }

      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      if (window.jQuery) {
        window.jQuery(select).trigger('change');
      }

      return { text: clean(option.textContent), value: option.value };
    },
    { selector, text, contains },
  );
}

async function setDateInput(page, selector, date) {
  await page.evaluate(
    ({ selector: inputSelector, date: value }) => {
      const input = document.querySelector(inputSelector);

      if (!input) {
        throw new Error(`Не найдено поле даты ${inputSelector}`);
      }

      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      if (window.jQuery && window.jQuery(input).datepicker) {
        window.jQuery(input).datepicker('setDate', value);
        window.jQuery(input).trigger('change');
      }
    },
    { selector, date },
  );

  const actualDate = await page.locator(selector).inputValue();

  if (actualDate !== date) {
    throw new Error(`Дата выставилась неверно: ${actualDate} вместо ${date}`);
  }
}

async function closeModalIfOpen(page) {
  const modal = page.locator('.modal.show');

  if ((await modal.count()) === 0) {
    return;
  }

  await page.keyboard.press('Escape').catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 2000 }).catch(async () => {
    await page
      .locator('.modal.show .btn-close, .modal.show button')
      .filter({ hasText: 'Отмена' })
      .first()
      .click({
        timeout: 2000,
      })
      .catch(() => {});
  });
  await modal.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
}

async function waitForSelectedTeacher(page) {
  await page.waitForFunction(
    () => {
      const select = document.querySelector('.modal #Lesson_EmployeeID, #Lesson_EmployeeID');
      return Boolean(select?.selectedOptions?.[0]?.textContent?.trim());
    },
    null,
    { timeout: 5000 },
  );

  return page
    .locator('.modal #Lesson_EmployeeID, #Lesson_EmployeeID')
    .first()
    .evaluate((select) =>
      (select.selectedOptions[0]?.textContent || '').replace(/\s+/g, ' ').trim(),
    );
}

function getAttendanceSheetSearchText(lesson) {
  const normalizedSubject = normalizeComparableText(lesson.subject);
  const normalizedType = normalizeComparableText(lesson.type);

  if (normalizedSubject.includes('методология и технология проектирования информационных систем')) {
    if (normalizedType.includes('лекция') || normalizedType.includes('лаборатор')) {
      return 'Методология и технология проектирования информационных систем (экзамен)';
    }

    return 'Методология и технология проектирования информационных систем (защита КП/КР)';
  }

  if (
    normalizedType.includes('кр') ||
    normalizedType.includes('защита') ||
    normalizedType.includes('консультация')
  ) {
    return 'защита КП/КР';
  }

  return lesson.subject;
}

function getExpectedAttendanceSheetName(lesson) {
  const normalizedSubject = normalizeComparableText(lesson.subject);
  const normalizedType = normalizeComparableText(lesson.type);

  if (normalizedSubject.includes('методология и технология проектирования информационных систем')) {
    if (normalizedType.includes('консультац') && normalizedType.includes('кр')) {
      return 'Методология и технология проектирования информационных систем (защита КП/КР)';
    }

    return 'Методология и технология проектирования информационных систем (экзамен)';
  }

  if (normalizedSubject.includes('иностранный язык')) {
    return 'Иностранный язык (зачёт с оценкой)';
  }

  if (normalizedSubject.includes('организационное поведение')) {
    return 'Организационное поведение (зачёт (без оценки))';
  }

  if (normalizedSubject.includes('информационное общество')) {
    return 'Информационное общество и проблемы прикладной информатики (зачёт с оценкой)';
  }

  if (normalizedSubject.includes('корпоративные информационные системы')) {
    return 'Корпоративные информационные системы (зачёт с оценкой)';
  }

  if (normalizedSubject.includes('технологии разработки программного обеспечения')) {
    return 'Технологии разработки программного обеспечения (зачёт с оценкой)';
  }

  if (normalizedSubject.includes('моделирование бизнес-процессов')) {
    return 'Моделирование бизнес-процессов в энергетике (экзамен)';
  }

  if (normalizedSubject.includes('анализ данных')) {
    return 'Анализ данных (экзамен)';
  }

  return lesson.subject;
}

function buildAttendanceSheetCountReport(semesterRange, scheduleLessons, headmanLessons) {
  const expectedCounts = new Map();
  const actualCounts = new Map();

  for (const lesson of scheduleLessons) {
    const { subjectName, type } = splitScheduleSubject(lesson.subject);
    const plannedLesson = {
      subject: subjectName,
      type,
    };

    if (!type || !shouldCountInStudyPlan(type)) {
      continue;
    }

    const sheetName = getExpectedAttendanceSheetName(plannedLesson);
    expectedCounts.set(sheetName, (expectedCounts.get(sheetName) || 0) + 1);
  }

  for (const lesson of headmanLessons) {
    if (!lesson.subject || !lesson.type) {
      continue;
    }

    const sheetName = cleanText(lesson.subject);
    actualCounts.set(sheetName, (actualCounts.get(sheetName) || 0) + 1);
  }

  const sheetNames = [...new Set([...expectedCounts.keys(), ...actualCounts.keys()])].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  return sheetNames.map((sheetName) => ({
    sheetName,
    actual: actualCounts.get(sheetName) || 0,
    expected: expectedCounts.get(sheetName) || 0,
    diff: (actualCounts.get(sheetName) || 0) - (expectedCounts.get(sheetName) || 0),
  }));
}

function printAttendanceSheetCountReport(report) {
  console.log('\nПроверка по листам журнала:');
  console.log('');

  for (const row of report) {
    if (row.diff === 0) {
      continue;
    }

    const sign = row.diff > 0 ? '+' : '';
    console.log(
      `${row.sheetName}: журнал ${row.actual}, план ${row.expected}, разница ${sign}${row.diff}`,
    );
  }
}

async function createMissingLesson(page, trainingJournalId, lesson) {
  await closeModalIfOpen(page);
  await page.goto(
    `https://bars.mpei.ru/bars_web/SG/TrainingJournal/EditTrainingJournal?tjID=${trainingJournalId}#Lessons`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(1000);
  await page.locator(`a[href*="CreateLesson?ownerID=${trainingJournalId}"]`).first().click();
  await page.waitForSelector('.modal #Date', { state: 'visible' });

  await setSelectByText(page, '.modal #AttendanceSheetID', getAttendanceSheetSearchText(lesson), {
    contains: true,
  });
  await waitForSelectedTeacher(page);
  await setDateInput(page, '.modal #Date', fullYearDate(lesson.date));
  await setSelectByText(page, '.modal #LessonTimeID', `${lesson.pairNumber} пара`, {
    contains: true,
  });
  await setSelectByText(page, '.modal #LessonTypeID', expectedLessonTypeForForm(lesson.type), {
    contains: true,
  });
  await setSelectByText(page, '.modal #LessonInfoStatusID', 'на рассмотрении');

  await page.locator('.modal button[type="submit"]').filter({ hasText: 'Сохранить' }).click();
  await page.waitForTimeout(1500);

  const errors = (
    await page
      .locator('.modal .field-validation-error, .modal .validation-summary-errors')
      .allTextContents()
  )
    .map(cleanText)
    .filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  await closeModalIfOpen(page);
}

async function fixLessonType(page, mismatch) {
  if (!mismatch.id) {
    throw new Error('У записи нет lesID, не могу открыть редактирование.');
  }

  await page.goto(
    `https://bars.mpei.ru/bars_web/SG/Lesson/EditLesson?lesID=${mismatch.id}&uip=tj`,
    {
      waitUntil: 'networkidle',
    },
  );
  await page.waitForSelector('#LessonTypeID', { state: 'attached' });
  await setSelectByText(page, '#LessonTypeID', expectedLessonTypeForForm(mismatch.expectedType), {
    contains: true,
  });
  await setSelectByText(page, '#LessonInfoStatusID', 'на рассмотрении');
  await page.locator('button[type="submit"]').filter({ hasText: 'Сохранить' }).click();
  await page.waitForTimeout(1500);

  const errors = (
    await page.locator('.field-validation-error, .validation-summary-errors').allTextContents()
  )
    .map(cleanText)
    .filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  await closeModalIfOpen(page);
}

async function deleteExtraLesson(page, extraLesson) {
  if (!extraLesson.deleteHref) {
    throw new Error('Нет ссылки удаления.');
  }

  await closeModalIfOpen(page);
  await page.goto(new URL(extraLesson.deleteHref, 'https://bars.mpei.ru').toString(), {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('button[type="submit"], input[type="submit"]', {
    state: 'attached',
    timeout: 10000,
  });
  await page.locator('button[type="submit"], input[type="submit"]').last().click();
  await page.waitForTimeout(1500);

  const errors = (
    await page
      .locator('.field-validation-error, .validation-summary-errors, .alert-danger')
      .allTextContents()
  )
    .map(cleanText)
    .filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

async function autofillHeadmanDiff(page, trainingJournalId, diff) {
  const results = {
    created: [],
    fixedTypes: [],
    failed: [],
  };

  for (const lesson of diff.missingLessons) {
    await randomDelay();

    try {
      await createMissingLesson(page, trainingJournalId, lesson);
      results.created.push(lesson);
      console.log(`Создано: ${lesson.date} | ${lesson.subject} | ${lesson.type}`);
    } catch (error) {
      await closeModalIfOpen(page);
      results.failed.push({ lesson, error: error.message });
      console.log(
        `Не удалось создать: ${lesson.date} | ${lesson.subject} | ${lesson.type} | ${error.message}`,
      );
    }
  }

  for (const mismatch of diff.editableTypeMismatches) {
    await randomDelay();

    try {
      await fixLessonType(page, mismatch);
      results.fixedTypes.push(mismatch);
      console.log(
        `Тип исправлен: ${mismatch.date} | ${mismatch.subject} | ${mismatch.currentType} -> ${mismatch.expectedType}`,
      );
    } catch (error) {
      await closeModalIfOpen(page);
      results.failed.push({ lesson: mismatch, error: error.message });
      console.log(
        `Не удалось исправить тип: ${mismatch.date} | ${mismatch.subject} | ${error.message}`,
      );
    }
  }

  return results;
}

async function deleteExtraHeadmanLessons(page, extraLessons) {
  const results = {
    deleted: [],
    skipped: [],
    failed: [],
  };

  for (const lesson of extraLessons) {
    if (!lesson.canDelete) {
      results.skipped.push(lesson);
      continue;
    }

    await randomDelay();

    try {
      await deleteExtraLesson(page, lesson);
      results.deleted.push(lesson);
      console.log(`Убрано: ${lesson.date} | ${lesson.subject} | ${lesson.type}`);
    } catch (error) {
      await closeModalIfOpen(page);
      results.failed.push({ lesson, error: error.message });
      console.log(
        `Не удалось убрать: ${lesson.date} | ${lesson.subject} | ${lesson.type} | ${error.message}`,
      );
    }
  }

  return results;
}

await ensureAuthState();

const timetableStore = new TimetableStore();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();

try {
  const groups = await loadAccountGroups({
    baseUrl: BASE_URL,
    url: (path) => new URL(path, BASE_URL).href,
    getHtml: async (url) => {
      const response = await context.request.get(url);
      if (!response.ok()) throw new Error(`БАРС вернул HTTP ${response.status()}.`);
      return response.text();
    },
  });
  if (!groups.length) throw new Error('У аккаунта нет доступных групп.');
  const choices = groups.map((group) => ({ ...group, title: `${group.name} · ${group.status}` }));
  if (choices.length > 1) printJournals(choices, 'Группы аккаунта');
  const group = choices.length === 1 ? choices[0] : await askJournalChoice(choices, 'Номер группы');
  GROUP_NAME = group.name;
  JOURNALS_URL = new URL(
    `SG/TrainingJournal/ListStudyGroup__TrainingJournals?sgID=${encodeURIComponent(group.id)}`,
    BASE_URL,
  ).href;
  TIMETABLE_URL = new URL(
    `Open/RUZ/Timetable?rt=3&name=${encodeURIComponent(group.name)}`,
    BASE_URL,
  ).href;
  await page.goto(JOURNALS_URL, { waitUntil: 'networkidle' });

  if (page.url().includes('Login') || page.url().includes('login')) {
    throw new Error('Сохраненная сессия не сработала. Обнови ее командой: npm run login');
  }

  const journals = await extractJournals(page);

  if (journals.length === 0) {
    throw new Error('Не нашел журналы на странице. Возможно, изменилась разметка или нет доступа.');
  }

  printJournals(journals);
  const selected = await askJournalChoice(journals);

  console.log('\nВыбран журнал:');
  console.log(selected.title);

  if (selected.href) {
    console.log(selected.href);
  }

  const semesterRange = getSemesterRange(selected.title);
  const trainingJournalId = getTrainingJournalId(selected);
  const timetableHtml = await fetchTimetableHtml(page, semesterRange);
  const lessons = await parseTimetable(page, timetableHtml);

  timetableStore.save({
    groupName: GROUP_NAME,
    journal: selected,
    semesterRange,
    lessons,
  });

  console.log(
    `\nРасписание сохранено в памяти: ${timetableStore.lessonsCount} занятий, ${timetableStore.daysCount} дней с занятиями.`,
  );

  const headmanLessonsHtml = await fetchHeadmanLessonsHtml(page, trainingJournalId);
  const headmanLessons = await parseHeadmanLessons(page, headmanLessonsHtml);

  timetableStore.saveHeadmanLessons(headmanLessons);

  console.log(`Записи старосты сохранены в памяти: ${timetableStore.headmanLessonsCount} занятий.`);

  const headmanLessonDiff = getHeadmanLessonDiff(semesterRange, lessons, headmanLessons);
  printHeadmanLessonDiff(headmanLessonDiff);
  const attendanceSheetCountReport = buildAttendanceSheetCountReport(
    semesterRange,
    lessons,
    headmanLessons,
  );
  printAttendanceSheetCountReport(attendanceSheetCountReport);

  const hasWork =
    headmanLessonDiff.missingLessons.length > 0 ||
    headmanLessonDiff.editableTypeMismatches.length > 0;

  if (hasWork) {
    const shouldAutofill = await askYesNo(
      '\nЗаполнить недостающие автоматически и исправить несогласованные записи с другим типом?',
    );

    if (shouldAutofill) {
      const results = await autofillHeadmanDiff(page, trainingJournalId, headmanLessonDiff);

      console.log('\nАвтозаполнение завершено:');
      console.log(`Создано занятий: ${results.created.length}`);
      console.log(`Исправлено типов: ${results.fixedTypes.length}`);
      console.log(`Ошибок: ${results.failed.length}`);
    } else {
      console.log('\nАвтозаполнение пропущено.');
    }
  }

  const removableExtraLessons = headmanLessonDiff.extraHeadmanLessons.filter(
    (lesson) => lesson.canDelete,
  );

  if (removableExtraLessons.length > 0) {
    const shouldDeleteExtras = await askYesNo(
      `\nУбрать лишние записи старосты со статусом "на рассмотрении" (${removableExtraLessons.length} шт.)?`,
    );

    if (shouldDeleteExtras) {
      const results = await deleteExtraHeadmanLessons(page, headmanLessonDiff.extraHeadmanLessons);

      console.log('\nУдаление лишних записей завершено:');
      console.log(`Убрано записей: ${results.deleted.length}`);
      console.log(`Пропущено записей: ${results.skipped.length}`);
      console.log(`Ошибок: ${results.failed.length}`);
    } else {
      console.log('\nУдаление лишних записей пропущено.');
    }
  }
} finally {
  await browser.close();
}
