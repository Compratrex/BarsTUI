import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { WeekSchedule } from '../../domain/models.js';
import { displayDate, moscowDate, shiftDate } from '../../domain/time.js';

type Row = { text: string; bold?: boolean; dim?: boolean; color?: 'cyan' };

function weekRows(week: WeekSchedule, columns: number, today: string): Row[] {
  const rows: Row[] = [];
  const append = (text: string, style: Omit<Row, 'text'> = {}, indent = 0) => {
    for (const line of wrapAnsi(text, Math.max(1, columns - indent), { hard: true }).split('\n'))
      rows.push({ text: ' '.repeat(indent) + line, ...style });
  };
  for (let day = 0; day < 7; day++) {
    const date = shiftDate(week.startDate, day);
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('ru-RU', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    if (day) append('');
    append(
      `${weekday[0].toLocaleUpperCase('ru-RU')}${weekday.slice(1)} · ${displayDate(date)}${date === today ? ' · сегодня' : ''}`,
      { color: 'cyan', bold: true },
    );
    const lessons = week.lessons.filter((lesson) => lesson.date === date);
    if (!lessons.length) append('Пар нет', { dim: true }, 2);
    for (const lesson of lessons) {
      append(lesson.subject, { bold: true }, 2);
      append(`${lesson.start}–${lesson.end} || ${lesson.pair} пара || ${lesson.type}`, {}, 2);
      const details = [lesson.location, lesson.teacher].filter(Boolean).join(' · ');
      if (details) append(details, { dim: true }, 2);
    }
  }
  return rows;
}

export function ScheduleView({
  week,
  columns,
  height,
  now,
  onWeek,
  onCurrent,
  onReload,
  onBack,
}: {
  week: WeekSchedule;
  columns: number;
  height: number;
  now: Date;
  onWeek: (direction: -1 | 1) => void;
  onCurrent: () => void;
  onReload: () => void;
  onBack: () => void;
}) {
  const [scroll, setScroll] = useState(0);
  const today = moscowDate(now);
  const rows = useMemo(() => weekRows(week, columns, today), [week, columns, today]);
  const visibleCount = Math.max(1, height - 5);
  const maxScroll = Math.max(0, rows.length - visibleCount);
  const offset = Math.min(scroll, maxScroll);
  const move = (delta: number) =>
    setScroll((value) => Math.max(0, Math.min(Math.min(value, maxScroll) + delta, maxScroll)));
  useInput((input, key) => {
    if (key.escape) onBack();
    else if (key.leftArrow) onWeek(-1);
    else if (key.rightArrow) onWeek(1);
    else if (key.upArrow) move(-1);
    else if (key.downArrow) move(1);
    else if (key.pageUp) move(-visibleCount);
    else if (key.pageDown) move(visibleCount);
    else if (input === 't' || input === 'е') onCurrent();
    else if (input === 'r' || input === 'к') onReload();
  });
  return (
    <Box flexGrow={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Неделя {displayDate(week.startDate)} — {displayDate(week.endDate)}
        </Text>
      </Box>
      {rows.slice(offset, offset + visibleCount).map((row, index) => (
        <Text key={offset + index} color={row.color} bold={row.bold} dimColor={row.dim}>
          {row.text || ' '}
        </Text>
      ))}
      <Box flexGrow={1} />
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ / PgUp PgDn прокрутка · {offset + 1}–{Math.min(offset + visibleCount, rows.length)} /{' '}
          {rows.length}
        </Text>
      </Box>
      <Text dimColor>←→ недели · T текущая · R обновить · Esc меню</Text>
    </Box>
  );
}
