import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserProfile } from '../src/infrastructure/bars/profile-parser.js';
import { profileHtml, profileName } from './fixtures/profile.js';

test('profile uses the roles block, deduplicates enrollments and excludes contact and 2FA data', () => {
  const profile = parseUserProfile(profileHtml);
  assert.deepEqual(profile, {
    account: 'public\\test-user',
    fullName: profileName,
    roles: ['Студент'],
  });
  assert.doesNotMatch(JSON.stringify(profile), /private|ТСТ-02|ТСТ-01|studentID/);
});

test('multiple linked people never result in an arbitrary full name', () => {
  const html = profileHtml.replace(`Студент ${profileName}`, 'Студент Другой Иван Петрович');
  const profile = parseUserProfile(html);
  assert.equal(profile.fullName, undefined);
  assert.equal(profile.account, 'public\\test-user');
  assert.deepEqual(profile.roles, ['Студент']);
});

test('roles are not inferred from access to attendance or marks, and malformed pages are rejected', () => {
  const profile = parseUserProfile(
    '<input id="Account" type="text" value="test-user"><a href="/journal">Журнал старосты</a>',
  );
  assert.deepEqual(profile, { account: 'test-user', roles: [] });
  assert.throws(() => parseUserProfile('<p>Temporary failure</p>'), /Не удалось прочитать профиль/);
});
