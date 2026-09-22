import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Lesson } from '../../domain/models.js';
import { displayDate } from '../../domain/time.js';
import { RevealText, useTextReveal } from '../../shared/ui/TextReveal.js';

import { StatusBadge } from './StatusBadge.js';

export function LessonList({
  items,
  initial = 0,
  height,
  backLabel,
  animate = false,
  onRevealComplete,
  onChoose,
  onBack,
}: {
  items: Lesson[];
  initial?: number;
  height: number;
  backLabel: string;
  animate?: boolean;
  onRevealComplete?: () => void;
  onChoose: (index: number) => void;
  onBack: () => void;
}) {
  const [cursor, setCursor] = useState(initial);
  const reveal = useTextReveal(animate, onRevealComplete);
  const rowLimit = Math.max(3, height - 2);
  // Count date headings and gaps as well as the two lines of each lesson.
  // Always repeat the first visible day's heading when scrolling within that day.
  const precedingCost = (index: number) => (items[index - 1].date === items[index].date ? 2 : 4);
  let offset = cursor;
  let rowsBefore = 0;
  while (offset > 0 && rowsBefore + precedingCost(offset) <= Math.floor((rowLimit - 3) / 2)) {
    rowsBefore += precedingCost(offset);
    offset--;
  }
  let end = offset;
  let usedRows = 0;
  while (end < items.length) {
    const cost = end === offset ? 3 : precedingCost(end);
    if (usedRows + cost > rowLimit) break;
    usedRows += cost;
    end++;
  }
  if (end === items.length) {
    while (offset > 0 && usedRows + precedingCost(offset) <= rowLimit) {
      usedRows += precedingCost(offset);
      offset--;
    }
  }
  const visibleCount = Math.max(1, end - offset);
  useInput((_input, key) => {
    if (key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown || key.return)
      reveal.finish();
    if (key.escape) onBack();
    if (key.upArrow) setCursor((index) => Math.max(0, index - 1));
    if (key.downArrow) setCursor((index) => Math.min(Math.max(0, items.length - 1), index + 1));
    if (key.pageUp) setCursor((index) => Math.max(0, index - visibleCount));
    if (key.pageDown)
      setCursor((index) => Math.min(Math.max(0, items.length - 1), index + visibleCount));
    if (key.return && items[cursor]) onChoose(cursor);
  });
  const visible = items.slice(offset, end);
  const lineCount = visible.reduce(
    (count, item, index) =>
      count + 2 + (index === 0 || visible[index - 1].date !== item.date ? 1 : 0),
    0,
  );
  let line = 0;
  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((item, index) => {
        const startsDate = index === 0 || items[offset + index - 1].date !== item.date;
        const weekday = new Date(`${item.date}T12:00:00Z`).toLocaleDateString('ru-RU', {
          weekday: 'long',
          timeZone: 'UTC',
        });
        const dateProgress = startsDate ? reveal.line(line++, lineCount) : 1;
        const titleProgress = reveal.line(line++, lineCount);
        const metadataProgress = reveal.line(line++, lineCount);
        return (
          <Box key={item.key} flexDirection="column" flexShrink={0}>
            {startsDate && (
              <Box marginTop={index === 0 ? 0 : 1}>
                <RevealText
                  progress={dateProgress}
                  bold
                  color="cyan"
                >{`${displayDate(item.date)} · ${weekday[0].toLocaleUpperCase('ru-RU')}${weekday.slice(1)}`}</RevealText>
              </Box>
            )}
            <Box paddingLeft={2} flexDirection="column">
              <Box columnGap={1} justifyContent="space-between">
                <Box flexShrink={1} minWidth={0}>
                  <RevealText
                    progress={titleProgress}
                    color={offset + index === cursor ? 'cyan' : undefined}
                    inverse={offset + index === cursor}
                    wrap="truncate-end"
                  >
                    {item.subject}
                  </RevealText>
                </Box>
                <Box flexShrink={0}>
                  <StatusBadge status={item.status} progress={titleProgress} />
                </Box>
              </Box>
              <RevealText
                progress={metadataProgress}
                dimColor
                wrap="truncate-end"
              >{`${item.start}–${item.end} · ${item.pair} пара · ${item.type}`}</RevealText>
            </Box>
          </Box>
        );
      })}
      {items.length === 0 && <Text dimColor>В журнале и расписании пока нет пар.</Text>}
      <Box flexGrow={1} />
      <Text dimColor wrap="truncate-end">
        {items.length ? `${cursor + 1} / ${items.length} · ` : ''}↑↓ / PgUp / PgDn выбор · Enter
        посещаемость · Esc {backLabel}
      </Text>
    </Box>
  );
}
