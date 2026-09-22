import { Box, Text } from 'ink';
import type { StudyGroup } from '../../domain/models.js';
import { menuItems } from '../navigation.js';

export function MainMenu({ selected, group }: { selected: number; group: StudyGroup | null }) {
  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      {group && (
        <Box marginBottom={1}>
          <Text color="cyan">
            {group.name}
            <Text dimColor> · {group.status}</Text>
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {menuItems.map(({ id, label }, index) => (
          <Text key={id} color={selected === index ? 'cyan' : undefined} bold={selected === index}>
            [{selected === index ? '*' : ' '}] {label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ / Tab — выбор · Enter — открыть · Ctrl+C — выход</Text>
      </Box>
    </Box>
  );
}
