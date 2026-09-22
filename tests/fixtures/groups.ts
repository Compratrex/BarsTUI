import type { StudyGroup } from '../../src/domain/models.js';

export const studyGroups: StudyGroup[] = [
  { id: 'old-group', name: 'ТСТ-02-21', studentId: 'old-student', status: 'завершил обучение' },
  { id: 'group', name: 'ТСТ-01м-25', studentId: 'fixture-student', status: 'обучается' },
];

export function studentListHtml(groups = studyGroups) {
  return `<table id="tbl__PartialListStudent" data-q-href="/bars_web/ST/Student/_PartialListStudent">
    <thead><tr><th>ФИО</th><th>Зачётная книжка</th><th>Статус (на сегодня)</th><th>Группа</th><th>ЛК</th></tr></thead>
    <tbody><tr><td><input placeholder="все"></td></tr>${groups
      .map(
        (group) => `<tr>
      <td><a href="/bars_web/ST/Student/Main?studentID=${group.studentId}">Тестов Алексей Сергеевич</a></td>
      <td>000000</td><td>${group.status}</td><td>${group.name}</td>
      <td><a href="/bars_web/ST/Student/Main?studentID=${group.studentId}">ЛК</a></td></tr>`,
      )
      .join('')}</tbody></table>`;
}

export function studentMainHtml(group: StudyGroup, hideGrades = false) {
  return `<select id="ddl_StudyFilterSemester"><option value="28" selected>2026/2027, Осенний семестр</option></select>
    <a href="/bars_web/Open/EmployeeSchedule/Schedule?sgID=${group.id}">Расписание</a>
    <a href="/bars_web/Open/EmployeeSchedule/Schedule?est=3&sgID=${group.id}">Сессия</a>
    ${hideGrades ? '' : `<a href="/bars_web/ST_Study/Main/Summary?studentID=${group.studentId}">Успеваемость</a>`}`;
}
