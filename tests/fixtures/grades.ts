export const gradeSemesters = [
  { id: '28', title: '2026/2027, Осенний семестр' },
  { id: '27', title: '2025/2026, Весенний семестр' },
  { id: '24', title: '2024/2025, Осенний семестр' },
];

export function gradePage(semesterId = '28'): string {
  const select = `<select id="ddl_StudyFilterSemester">${gradeSemesters.map((item) => `<option value="${item.id}" ${item.id === semesterId ? 'selected' : ''}>${item.title}</option>`).join('')}</select>`;
  // Mirrors the live page's empty semesters: selector only, no table or message.
  if (semesterId === '24') return select;
  const row = (
    subject: string,
    zero = false,
  ) => `<tr class="summary-header-min"><td class="summary-header-max"></td><td colspan="19">${subject}</td></tr>
    <tr><td class="summary-td-row-header summary-header-max">${subject}</td>${Array.from(
      { length: 16 },
      (_, index) =>
        `<td class="${index === 2 ? 'summary-td-current-week' : ''}">${
          index === 3
            ? zero
              ? '<span class="summary-mark" title="КМ-1. Проверка">0</span>'
              : `<span class="${semesterId === '28' ? 'summary-km' : 'summary-mark'}" title="КМ-1. Технологии виртуализации">${semesterId === '28' ? '1' : '4'}</span>`
            : index === 7
              ? '<span class="summary-mark" title="КМ-2. Облачные вычисления">5</span><br><span class="summary-mark" title="КМ-3. Практика">4</span>'
              : index === 15
                ? '<span class="summary-km" title="КМ-4. Защита">4</span>'
                : ''
        }</td>`,
    ).join('')}<td>4,25</td><td>4 (Д)</td><td>4</td></tr>`;
  return `${select}<h4>${gradeSemesters.find((item) => item.id === semesterId)!.title}, успеваемость</h4>
    <table id="tableMarkSummary"><thead><tr><th rowspan="2">Дисциплина</th><th colspan="16">Неделя обучения</th><th rowspan="2">ТБ</th><th rowspan="2">ПА</th><th rowspan="2">И</th></tr>
    <tr>${Array.from({ length: 16 }, (_, index) => `<th class="${index === 2 ? 'summary-td-current-week' : ''}">${index + 1}</th>`).join('')}</tr></thead><tbody>
    ${row('Тестовая дисциплина с достаточно длинным названием (экзамен)')}
    ${row('Тестовая дисциплина с достаточно длинным названием (защита КП/КР)', true)}
    </tbody></table><table id="tableSkipSummary"><tr><td>Посещаемость не должна попасть в оценки</td></tr></table>`;
}
