import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { GradeCell, GradesSummary, GradeSubject } from '../../domain/models.js';

type Line = { text: string; color?: 'red' | 'green' | 'cyan'; bold?: boolean };
const wrap = (text: string, width: number) =>
  wrapAnsi(text, Math.max(1, width), { hard: true }).split('\n');
const cellLines = (cell: GradeCell, width: number): Line[] =>
  cell.flatMap((mark) =>
    wrap(mark.value, width).map((text) => ({
      text,
      color: mark.kind === 'missing' ? ('red' as const) : ('green' as const),
    })),
  );
const center = (text: string, width: number) => {
  const padding = Math.max(0, width - text.length);
  return ' '.repeat(Math.floor(padding / 2)) + text + ' '.repeat(Math.ceil(padding / 2));
};

function detailLines(subject: GradeSubject, grades: GradesSummary, width: number): Line[] {
  const lines: Line[] = wrap(subject.subject, width).map((text) => ({
    text,
    color: 'cyan',
    bold: true,
  }));
  lines.push({ text: '' });
  const append = (label: string, values: GradeCell) => {
    for (const mark of values) {
      const status =
        mark.kind === 'missing' ? `КМ ${mark.value} · оценки нет` : `Оценка: ${mark.value}`;
      const text = `${label} · ${status}${mark.description ? ` · ${mark.description}` : ''}`;
      lines.push(
        ...wrap(text, width).map((text) => ({
          text,
          color: mark.kind === 'missing' ? ('red' as const) : ('green' as const),
        })),
      );
    }
  };
  subject.weeks.forEach((values, index) => append(`Неделя ${grades.weeks[index].label}`, values));
  if (!subject.weeks.some((values) => values.length))
    lines.push({ text: 'Контрольные мероприятия пока не указаны.' });
  lines.push({ text: '' });
  for (const [label, values] of [
    ['Текущий балл', subject.total],
    ['Промежуточная аттестация', subject.attestation],
    ['Итоговая оценка', subject.final],
  ] as const) {
    lines.push(
      ...wrap(`${label}: ${values.map((mark) => mark.value).join(' / ') || '—'}`, width).map(
        (text) => ({ text }),
      ),
    );
  }
  return lines;
}

export function GradesView({
  grades,
  columns,
  height,
  onSemester,
  onReload,
  onBack,
}: {
  grades: GradesSummary;
  columns: number;
  height: number;
  onSemester: (direction: -1 | 1) => void;
  onReload: () => void;
  onBack: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [firstWeek, setFirstWeek] = useState(0);
  const [details, setDetails] = useState(false);
  const [detailScroll, setDetailScroll] = useState(0);
  const selected = Math.min(cursor, Math.max(0, grades.subjects.length - 1));
  const subject = grades.subjects[selected];
  const width = Math.max(30, columns);
  const weekWidth = Math.min(
    7,
    Math.max(
      4,
      ...grades.subjects.flatMap((subject) =>
        subject.weeks.flatMap((cell) => cell.map((mark) => mark.value.length + 2)),
      ),
    ),
  );
  const totalWidths = (['total', 'attestation', 'final'] as const).map((key) =>
    Math.min(
      10,
      Math.max(
        key === 'final' ? 4 : 6,
        ...grades.subjects.flatMap((subject) => subject[key].map((mark) => mark.value.length + 2)),
      ),
    ),
  );
  const summaryWidth = totalWidths.reduce((sum, value) => sum + value, 0);
  const minSubjectWidth = Math.max(18, Math.min(32, Math.floor(width * 0.35)));
  const weekCount = Math.min(
    grades.weeks.length,
    Math.max(1, Math.floor((width - minSubjectWidth - summaryWidth - 6) / weekWidth)),
  );
  const weekOffset = Math.max(0, Math.min(firstWeek, grades.weeks.length - weekCount));
  const shownWeeks = grades.weeks.slice(weekOffset, weekOffset + weekCount);
  const subjectWidth = Math.max(4, width - weekCount * weekWidth - summaryWidth - 6);
  const bodyHeight = Math.max(1, height - 9);
  const currentWeek = grades.weeks.find((week) => week.current)?.label;
  const rows = grades.subjects.flatMap((item, index) => {
    const names = wrap(item.subject, subjectWidth - 2);
    const cells = [
      ...item.weeks
        .slice(weekOffset, weekOffset + weekCount)
        .map((cell) => cellLines(cell, weekWidth - 2)),
      ...[item.total, item.attestation, item.final].map((cell, col) =>
        cellLines(cell, totalWidths[col] - 2),
      ),
    ];
    return Array.from(
      { length: Math.max(names.length, ...cells.map((cell) => cell.length)) },
      (_, line) => ({ index, name: names[line] ?? '', cells: cells.map((cell) => cell[line]) }),
    );
  });
  const selectedStart = Math.max(
    0,
    rows.findIndex((row) => row.index === selected),
  );
  const selectedEnd = selectedStart + rows.filter((row) => row.index === selected).length;
  const rowOffset = Math.max(
    0,
    Math.min(selectedStart, Math.max(0, selectedEnd - bodyHeight), rows.length - bodyHeight),
  );
  const detail = subject ? detailLines(subject, grades, width) : [];
  const detailHeight = Math.max(1, height - 2);
  const detailOffset = Math.max(0, Math.min(detailScroll, detail.length - detailHeight));
  useInput((input, key) => {
    const letter = input.toLowerCase();
    if (key.escape) {
      if (details) {
        setDetails(false);
        setDetailScroll(0);
      } else onBack();
    } else if (details) {
      if (key.upArrow || key.pageUp)
        setDetailScroll(Math.max(0, detailOffset - (key.pageUp ? detailHeight : 1)));
      else if (key.downArrow || key.pageDown)
        setDetailScroll(
          Math.min(
            Math.max(0, detail.length - detailHeight),
            detailOffset + (key.pageDown ? detailHeight : 1),
          ),
        );
      else if (key.return) {
        setDetails(false);
        setDetailScroll(0);
      }
    } else if (key.upArrow || key.pageUp) setCursor(Math.max(0, selected - (key.pageUp ? 3 : 1)));
    else if (key.downArrow || key.pageDown)
      setCursor(
        Math.min(Math.max(0, grades.subjects.length - 1), selected + (key.pageDown ? 3 : 1)),
      );
    else if (key.leftArrow) setFirstWeek(Math.max(0, weekOffset - 1));
    else if (key.rightArrow)
      setFirstWeek(Math.min(Math.max(0, grades.weeks.length - weekCount), weekOffset + 1));
    else if (key.return && subject) {
      setDetails(true);
      setDetailScroll(0);
    } else if (letter === '[' || letter === 'х') onSemester(-1);
    else if (letter === ']' || letter === 'ъ') onSemester(1);
    else if (letter === 'r' || letter === 'к') onReload();
  });
  if (details)
    return (
      <Box flexDirection="column" flexGrow={1}>
        {detail.slice(detailOffset, detailOffset + detailHeight).map((line, index) => (
          <Text key={index} color={line.color} bold={line.bold}>
            {line.text || ' '}
          </Text>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>↑↓ / PgUp PgDn прокрутка · Esc / Enter к таблице</Text>
      </Box>
    );
  if (!grades.subjects.length)
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text>В этом семестре данных об успеваемости нет.</Text>
        </Box>
        <Text dimColor>[ ] семестр · R обновить · Esc меню</Text>
      </Box>
    );
  const groups = [subjectWidth, shownWeeks.length * weekWidth, ...totalWidths];
  const border = (left: string, join: string, right: string) =>
    left + groups.map((length) => '─'.repeat(length)).join(join) + right;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text dimColor wrap="truncate-end">
        Недели {shownWeeks[0]?.label}–{shownWeeks.at(-1)?.label}
        {currentWeek ? ` · текущая ${currentWeek}` : ''} · Дисциплина {selected + 1}/
        {grades.subjects.length}
      </Text>
      <Text dimColor>{border('┌', '┬', '┐')}</Text>
      <Text>
        <Text dimColor>│</Text>
        <Text bold>{center('Дисциплина', subjectWidth)}</Text>
        <Text dimColor>│</Text>
        {shownWeeks.map((week) => (
          <Text
            key={week.label}
            color={week.current ? 'white' : undefined}
            backgroundColor={week.current ? 'cyan' : undefined}
            bold
          >
            {center(week.label, weekWidth)}
          </Text>
        ))}
        <Text dimColor>│</Text>
        {['ТБ', 'ПА', 'И'].map((label, index) => (
          <Text key={label}>
            <Text bold>{center(label, totalWidths[index])}</Text>
            <Text dimColor>│</Text>
          </Text>
        ))}
      </Text>
      <Text dimColor>{border('├', '┼', '┤')}</Text>
      {rows.slice(rowOffset, rowOffset + bodyHeight).map((row, index) => (
        <Text key={rowOffset + index}>
          <Text dimColor>│</Text>
          <Text color={row.index === selected ? 'cyan' : undefined} bold={row.index === selected}>
            {' ' + row.name.padEnd(subjectWidth - 2) + ' '}
          </Text>
          <Text dimColor>│</Text>
          {row.cells.map((cell, col) => {
            const value = cell?.text ?? '';
            const cellWidth = col < weekCount ? weekWidth : totalWidths[col - weekCount];
            const padding = Math.max(0, cellWidth - value.length);
            return (
              <Text key={col}>
                {' '.repeat(Math.floor(padding / 2))}
                <Text color={cell?.color} underline={row.index === selected && !!value}>
                  {value}
                </Text>
                {' '.repeat(Math.ceil(padding / 2))}
                {col >= weekCount - 1 && <Text dimColor>│</Text>}
              </Text>
            );
          })}
        </Text>
      ))}
      <Text dimColor>{border('└', '┴', '┘')}</Text>
      <Box flexGrow={1} />
      <Text>
        <Text color="red">Красный — КМ без оценки</Text> ·{' '}
        <Text color="green">Зелёный — оценка</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        ТБ — текущий балл · ПА — аттестация · И — итог
      </Text>
      <Text dimColor wrap="truncate-end">
        ↑↓ дисциплины · ←→ недели · Enter подробнее
      </Text>
      <Text dimColor wrap="truncate-end">
        [ ] семестр · R обновить · Esc меню
      </Text>
    </Box>
  );
}
