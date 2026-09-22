import { useEffect, useState } from 'react';
import { Box, Text, useAnimation, useInput, useIsScreenReaderEnabled } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { IntegrityEntry, IntegrityReport } from '../../domain/models.js';
import { displayDate } from '../../domain/time.js';

const beats = [180, 280, 140, 220, 160];
const verdict = (entry: IntegrityEntry) =>
  entry.status === 'ok' ? 'Норма' : entry.status === 'violation' ? 'Нарушение' : 'Ещё не прошла';
const color = (entry: IntegrityEntry) =>
  entry.status === 'ok' ? 'green' : entry.status === 'violation' ? 'red' : 'gray';
const metadata = (entry: IntegrityEntry) =>
  `${displayDate(entry.lesson.date)} · ${entry.lesson.start}–${entry.lesson.end} · ${entry.lesson.pair} пара · ${entry.lesson.type}`;

export function IntegrityView({
  report,
  height,
  columns,
  onBack,
  onReload,
  onRepair,
  instant = false,
}: {
  report: IntegrityReport;
  height: number;
  columns: number;
  onBack: () => void;
  onReload: () => void;
  onRepair?: () => void;
  instant?: boolean;
}) {
  const reader = useIsScreenReaderEnabled();
  const [completed, setCompleted] = useState(reader || instant ? report.entries.length : 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const [detailScroll, setDetailScroll] = useState(0);
  const [repairFocused, setRepairFocused] = useState(false);
  const finished = completed >= report.entries.length;
  const canRepair =
    finished && report.entries.some((entry) => entry.status === 'violation') && !!onRepair;
  const { time } = useAnimation({ interval: 60, isActive: !finished && !reader });
  useEffect(() => {
    if (reader) {
      setCompleted(report.entries.length);
      return;
    }
    if (finished) return;
    const timer = setTimeout(
      () => setCompleted((value) => Math.min(report.entries.length, value + 1)),
      beats[completed % beats.length],
    );
    return () => clearTimeout(timer);
  }, [completed, finished, reader, report]);
  const available = Math.min(report.entries.length, completed + 1);
  const cursor = Math.max(0, Math.min(selected ?? completed, available - 1));
  const visibleCount = Math.max(1, Math.floor((height - 7 - (canRepair ? 1 : 0)) / 2));
  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), available - visibleCount),
  );
  const entry = report.entries[cursor];
  const detailHeight = Math.max(1, height - 4);
  const detailLines = entry
    ? [
        entry.lesson.subject,
        metadata(entry),
        `[ ${verdict(entry)} ]`,
        '',
        ...entry.details,
      ].flatMap((line) => wrapAnsi(line, Math.max(1, columns), { hard: true }).split('\n'))
    : [];
  const detailsOffset = Math.min(detailScroll, Math.max(0, detailLines.length - detailHeight));
  useInput((input, key) => {
    if (key.escape) {
      if (details) setDetails(false);
      else onBack();
      return;
    }
    if (!details && canRepair && (/^[fа]$/i.test(input) || (key.return && repairFocused))) {
      onRepair?.();
      return;
    }
    if (!details && canRepair && key.tab) {
      setRepairFocused((value) => !value);
      return;
    }
    if (input === 'r' || input === 'к') {
      onReload();
      return;
    }
    if (input === ' ') {
      setCompleted(report.entries.length);
      return;
    }
    if (key.return && entry && cursor < completed) {
      setSelected(cursor);
      setDetails((value) => !value);
      setDetailScroll(0);
      return;
    }
    const direction = key.upArrow || key.pageUp ? -1 : key.downArrow || key.pageDown ? 1 : 0;
    if (!direction) return;
    setRepairFocused(false);
    if (details)
      setDetailScroll((value) =>
        Math.max(
          0,
          Math.min(
            value + direction * (key.pageUp || key.pageDown ? detailHeight : 1),
            detailLines.length - detailHeight,
          ),
        ),
      );
    else
      setSelected(
        Math.max(
          0,
          Math.min(
            cursor + direction * (key.pageUp || key.pageDown ? visibleCount : 1),
            available - 1,
          ),
        ),
      );
  });
  const checked = report.entries.slice(0, completed);
  const totals = { ok: 0, violation: 0, pending: 0 };
  for (const item of checked) totals[item.status]++;
  const stamp = new Date(report.checkedAt).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
  });
  const dots = '.'.repeat(time % 1_580 < 420 ? 1 : time % 1_580 < 680 ? 2 : 3).padEnd(3);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text dimColor wrap="truncate-end">
          Сверка на {stamp} МСК · расписание ↔ журнал старосты
        </Text>
      </Box>
      {details ? (
        <>
          {detailLines.slice(detailsOffset, detailsOffset + detailHeight).map((line, index) => (
            <Text key={detailsOffset + index}>{line || ' '}</Text>
          ))}
          <Box flexGrow={1} />
          <Text dimColor>↑↓ / PgUp / PgDn прокрутка · Esc к результатам</Text>
        </>
      ) : (
        <>
          {!report.entries.length && (
            <Text dimColor>В расписании и журнале нет пар для проверки.</Text>
          )}
          {report.entries
            .slice(offset, Math.min(available, offset + visibleCount))
            .map((item, index) => {
              const position = offset + index;
              const checking = position === completed && !finished;
              return (
                <Box key={item.key} flexDirection="column" flexShrink={0}>
                  <Box columnGap={1} justifyContent="space-between">
                    <Box flexShrink={1} minWidth={0}>
                      <Text
                        color={position === cursor ? 'cyan' : undefined}
                        inverse={position === cursor && !repairFocused}
                        wrap="truncate-end"
                      >
                        {item.lesson.subject}
                      </Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Text color={checking ? 'cyan' : color(item)}>
                        {checking ? `[ Проверяем${dots} ]` : `[ ${verdict(item)} ]`}
                      </Text>
                    </Box>
                  </Box>
                  <Text dimColor wrap="truncate-end">
                    {metadata(item)}
                  </Text>
                </Box>
              );
            })}
          <Box flexGrow={1} />
          <Box height={2} flexShrink={0}>
            <Text color={entry && cursor < completed ? color(entry) : 'cyan'} wrap="truncate-end">
              {entry
                ? cursor < completed
                  ? entry.details.join(' ')
                  : 'Сопоставляем пару с записями журнала…'
                : ' '}
            </Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={finished ? 'white' : 'cyan'}>
              {finished ? 'Готово' : 'Проверяем'}: {completed} / {report.entries.length}
            </Text>
            <Text color="green"> · Норма: {totals.ok}</Text>
            <Text color="red"> · Нарушений: {totals.violation}</Text>
            <Text dimColor> · Ещё не прошли: {totals.pending}</Text>
          </Text>
          {canRepair && (
            <Text color="cyan" inverse={repairFocused}>
              [ Исправить нарушения · F ]
              <Text inverse={false} dimColor>
                {' '}
                Tab — кнопка · Enter — нажать
              </Text>
            </Text>
          )}
          <Text dimColor wrap="truncate-end">
            ↑↓ / PgUp / PgDn выбор · Enter причины · Пробел все результаты
          </Text>
          <Text dimColor>R повторить проверку · Esc меню</Text>
        </>
      )}
    </Box>
  );
}
