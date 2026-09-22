import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { StudyGroup } from '../../domain/models.js';
import { sameGroup } from './selection.js';

type Props = {
  groups: StudyGroup[];
  selected: StudyGroup | null;
  height: number;
  onChoose: (group: StudyGroup) => void;
  onBack: () => void;
  onReload: () => void;
};

export function GroupPicker({ groups, selected, height, onChoose, onBack, onReload }: Props) {
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      selected
        ? groups.findIndex((group) => sameGroup(group, selected))
        : groups.findIndex((group) => /^обучается$/i.test(group.status)),
    ),
  );
  const visibleCount = Math.max(1, Math.floor((height - 5) / 3));
  const index = Math.min(cursor, Math.max(0, groups.length - 1));
  const offset = Math.max(
    0,
    Math.min(index - Math.floor(visibleCount / 2), groups.length - visibleCount),
  );
  useInput((input, key) => {
    if (key.escape) onBack();
    else if (/^[rк]$/i.test(input)) onReload();
    else if (key.return && groups[index]) onChoose(groups[index]);
    else if (key.upArrow || key.pageUp)
      setCursor(Math.max(0, index - (key.pageUp ? visibleCount : 1)));
    else if (key.downArrow || key.pageDown || key.tab)
      setCursor(
        Math.min(Math.max(0, groups.length - 1), index + (key.pageDown ? visibleCount : 1)),
      );
  });
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="cyan">
        Выбери группу
      </Text>
      <Box marginY={1} flexDirection="column">
        {groups.slice(offset, offset + visibleCount).map((group, position) => (
          <Box key={`${group.id}:${group.studentId}`} flexDirection="column" marginBottom={1}>
            <Text color="cyan" inverse={position + offset === index} wrap="truncate-end">
              {group.name}
              {selected && sameGroup(group, selected) ? ' · выбрана' : ''}
            </Text>
            <Text
              color={/^обучается$/i.test(group.status) ? 'green' : undefined}
              wrap="truncate-end"
            >
              {group.status}
            </Text>
          </Box>
        ))}
        {!groups.length && <Text>Нет доступных групп. Можно повторить загрузку.</Text>}
      </Box>
      <Box flexGrow={1} />
      <Text dimColor>Выбор сохраняется для текущего аккаунта.</Text>
      <Text dimColor wrap="truncate-end">
        ↑↓ / PgUp / PgDn выбор · Enter выбрать · R обновить
        {selected ? ' · Esc меню' : ' · Ctrl+C выход'}
      </Text>
    </Box>
  );
}
