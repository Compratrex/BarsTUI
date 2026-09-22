import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStudentAccounts,
  parseStudentMemberships,
  parseStudyGroupId,
} from '../src/infrastructure/bars/groups-parser.js';
import { loadAccountGroups } from '../src/infrastructure/bars/group-directory.js';
import { preferredGroup, groupScope } from '../src/features/groups/selection.js';
import { profileHtml } from './fixtures/profile.js';
import { studentListHtml, studentMainHtml, studyGroups } from './fixtures/groups.js';

const baseUrl = 'https://example.test/bars_web/';

test('groups use only own profile enrollments, join statuses by student ID and resolve schedule IDs', () => {
  const accounts = parseStudentAccounts(profileHtml, baseUrl);
  const stranger = { ...studyGroups[0], studentId: 'stranger', id: 'unrelated' };
  const { memberships } = parseStudentMemberships(
    studentListHtml([stranger, ...studyGroups].reverse()),
    accounts,
    baseUrl,
  );
  assert.equal(memberships.length, 2);
  for (const group of studyGroups) {
    const membership = memberships.find((item) => item.studentId === group.studentId)!;
    assert.equal(membership.name, group.name);
    assert.equal(membership.status, group.status);
    assert.equal(parseStudyGroupId(studentMainHtml(group), baseUrl), group.id);
  }
  assert.deepEqual(
    parseStudentAccounts('<div><label for="StudentAccounts">Роли</label></div>', baseUrl),
    [],
  );
});

test('ambiguous, malformed and foreign group pages are rejected rather than choosing a default', () => {
  const accounts = parseStudentAccounts(profileHtml, baseUrl);
  assert.throws(() => parseStudentAccounts('<p>Error</p>', baseUrl), /учебные записи/);
  assert.throws(
    () =>
      parseStudentAccounts(
        profileHtml.replace('/bars_web/ST/Student/Main?', 'https://evil.test/ST/Student/Main?'),
        baseUrl,
      ),
    /за пределы/,
  );
  assert.throws(
    () => parseStudentMemberships('<table></table>', accounts, baseUrl),
    /Формат списка/,
  );
  assert.throws(
    () =>
      parseStudentMemberships(studentListHtml([studyGroups[0], studyGroups[0]]), accounts, baseUrl),
    /неоднозначна/,
  );
  assert.throws(
    () => parseStudyGroupId(studyGroups.map((group) => studentMainHtml(group)).join(''), baseUrl),
    /однозначно/,
  );
  assert.throws(
    () =>
      parseStudyGroupId(
        '<a href="https://evil.test/Open/EmployeeSchedule/Schedule?sgID=x">Расписание</a>',
        baseUrl,
      ),
    /за пределы/,
  );
  assert.throws(() => parseStudyGroupId('<p>Нет расписания</p>', baseUrl), /однозначно/);
});

test('group discovery follows the student list pagination and refuses incomplete results', async () => {
  const requests: URL[] = [];
  let repeat = false;
  const session = {
    baseUrl,
    url: (path: string) => new URL(path, baseUrl).href,
    getHtml: async (path: string) => {
      const url = new URL(path);
      requests.push(url);
      if (url.pathname.endsWith('EditUser')) return profileHtml;
      if (url.pathname.endsWith('/Main'))
        return studentMainHtml(
          studyGroups.find((group) => group.studentId === url.searchParams.get('studentID'))!,
        );
      if (url.pathname.endsWith('_PartialListStudent') && !repeat)
        return studentListHtml([studyGroups[1]]);
      return studentListHtml([studyGroups[0]]);
    },
  };
  assert.deepEqual(await loadAccountGroups(session), studyGroups);
  assert.equal(
    JSON.parse(
      requests
        .find((url) => url.pathname.endsWith('_PartialListStudent'))!
        .searchParams.get('query')!,
    ).Page,
    '2',
  );
  repeat = true;
  await assert.rejects(loadAccountGroups(session), /все группы/);
});

test('only one group is selected implicitly; saved preferences and draft scopes include enrollment and account', () => {
  assert.equal(preferredGroup(studyGroups, undefined), null);
  assert.deepEqual(preferredGroup([studyGroups[1]], undefined), studyGroups[1]);
  assert.deepEqual(preferredGroup(studyGroups, studyGroups[0]), studyGroups[0]);
  assert.equal(preferredGroup(studyGroups, { id: 'deleted', studentId: 'old-student' }), null);
  assert.equal(preferredGroup(studyGroups, { id: studyGroups[0].id, studentId: 'stranger' }), null);
  assert.notEqual(groupScope('alice', studyGroups[0]), groupScope('alice', studyGroups[1]));
  assert.notEqual(groupScope('alice', studyGroups[0]), groupScope('bob', studyGroups[0]));
  assert.equal(groupScope(null, studyGroups[0]), null);
});
