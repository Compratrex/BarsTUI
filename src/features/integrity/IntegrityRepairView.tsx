import { useState } from 'react';
import { Box, Text, useAnimation, useInput, useIsScreenReaderEnabled } from 'ink';
import type { Lesson } from '../../domain/models.js';
import { planIntegrityRepair, type RepairItem, type RepairState } from './integrity-repair.js';
import { displayDate } from '../../domain/time.js';

const label = (item: RepairItem, running: boolean) =>
  ({
    queued: running ? 'В очереди' : 'Не выполнено',
    working: 'Исправляем',
    fixed: 'Исправлено',
    manual: 'Нужно вручную',
    failed: 'Ошибка',
  })[item.status];
const color = (item: RepairItem) =>
  ({ queued: 'gray', working: 'cyan', fixed: 'green', manual: 'yellow', failed: 'red' })[
    item.status
  ];
export function IntegrityRepairView({
  state,
  height,
  onStop,
  onBack,
  onReload,
  onAttendance,
}: {
  state: RepairState;
  height: number;
  onStop: () => void;
  onBack: () => void;
  onReload: () => void;
  onAttendance: (lesson: Lesson) => void;
}) {
  const reader = useIsScreenReaderEnabled();
  const { time } = useAnimation({ interval: 50, isActive: state.running && !reader });
  const [selected, setSelected] = useState<number | null>(null);
  const active = state.items.findIndex((item) => item.status === 'working');
  const attention = state.items.findIndex(
    (item) => item.status === 'failed' || item.status === 'manual',
  );
  const cursor = Math.max(
    0,
    Math.min(
      state.items.length - 1,
      state.running && active >= 0
        ? active
        : (selected ?? (attention >= 0 ? attention : state.items.length - 1)),
    ),
  );
  const visibleCount = Math.max(1, Math.floor((height - 7) / 2));
  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), state.items.length - visibleCount),
  );
  const entry = state.items[cursor];
  const plan = entry ? planIntegrityRepair(entry.entry) : null;
  const manualLesson =
    entry?.status === 'manual' && plan?.kind === 'manual' ? plan.attendance : undefined;
  useInput((input, key) => {
    if (state.running) {
      if (key.escape) onStop();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (input === 'r' || input === 'к') {
      onReload();
      return;
    }
    if (key.return && manualLesson) {
      onAttendance(manualLesson);
      return;
    }
    const direction = key.upArrow || key.pageUp ? -1 : key.downArrow || key.pageDown ? 1 : 0;
    if (direction)
      setSelected(
        Math.max(
          0,
          Math.min(
            state.items.length - 1,
            cursor + direction * (key.pageUp || key.pageDown ? visibleCount : 1),
          ),
        ),
      );
  });
  const fixed = state.items.filter((item) => item.status === 'fixed').length;
  const manual = state.items.filter((item) => item.status === 'manual').length;
  const failed = state.items.filter((item) => item.status === 'failed').length;
  const dots = '.'.repeat(time % 1580 < 420 ? 1 : time % 1580 < 680 ? 2 : 3).padEnd(3);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color="cyan">
          {state.running
            ? state.stopping
              ? 'Останавливаем после текущей пары…'
              : 'Исправляем по расписанию…'
            : 'Результаты исправления'}
        </Text>
      </Box>
      {state.items.slice(offset, offset + visibleCount).map((item, index) => (
        <Box key={item.entry.key} flexDirection="column" flexShrink={0}>
          <Box columnGap={1} justifyContent="space-between">
            <Box minWidth={0} flexShrink={1}>
              <Text
                color={cursor === offset + index ? 'cyan' : undefined}
                inverse={cursor === offset + index}
                wrap="truncate-end"
              >
                {item.entry.lesson.subject}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={color(item)}>
                [ {label(item, state.running)}
                {item.status === 'working' ? dots : ''} ]
              </Text>
            </Box>
          </Box>
          <Text dimColor wrap="truncate-end">
            {displayDate(item.entry.lesson.date)} · {item.entry.lesson.start}–
            {item.entry.lesson.end} · {item.entry.lesson.pair} пара · {item.entry.lesson.type}
          </Text>
        </Box>
      ))}
      <Box flexGrow={1} />
      <Box height={2} flexShrink={0}>
        <Text color={entry ? color(entry) : 'gray'} wrap="truncate-end">
          {entry?.message || ' '}
        </Text>
      </Box>
      <Text wrap="truncate-end">
        <Text color="green">Исправлено: {fixed}</Text>
        <Text color="yellow"> · Вручную: {manual}</Text>
        <Text color="red"> · Ошибок: {failed}</Text>
        <Text dimColor> · Всего: {state.items.length}</Text>
      </Text>
      {state.running ? (
        <Text dimColor>Esc — остановить после текущей пары</Text>
      ) : (
        <>
          <Text color={manualLesson ? 'cyan' : 'gray'}>
            {manualLesson ? '[ Открыть посещаемость · Enter ]' : '↑↓ / PgUp / PgDn — результаты'}
          </Text>
          <Text dimColor>R — новая проверка · Esc — к результатам сверки</Text>
        </>
      )}
    </Box>
  );
}
