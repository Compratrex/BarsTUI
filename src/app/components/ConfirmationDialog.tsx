import { Box, Text } from 'ink';
import type { Confirmation } from '../types.js';

const messages: Record<Confirmation, string> = {
  exit: 'Есть несохранённые отметки. Выйти?',
  reload: 'Отменить изменения этой пары и загрузить отметки из БАРСа?',
};

export function ConfirmationDialog({ action }: { action: Confirmation }) {
  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
      <Text color="yellow">{messages[action]}</Text>
      <Text>Enter — подтвердить · Esc — продолжить</Text>
    </Box>
  );
}
