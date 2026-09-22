import { Box, Text } from 'ink';
import type { UserProfile } from '../../domain/models.js';
import { APP_CODENAME, APP_VERSION } from '../app-info.js';
import { pageTitles, type AuthenticatedScreen } from '../navigation.js';

type Props = {
  screen: AuthenticatedScreen;
  subtitle?: string;
  profile: UserProfile | null;
  time: Date;
};

export function AppHeader({ screen, subtitle, profile, time }: Props) {
  const formattedTime = time.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
  const name = profile?.fullName ?? profile?.account ?? 'Профиль БАРСа недоступен';
  const roles = profile?.roles.length ? profile.roles.join(' / ') : 'Роль: —';

  return (
    <Box justifyContent="space-between" columnGap={2} marginBottom={1} flexShrink={0}>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold>БАРС · {pageTitles[screen]}</Text>
          {screen === 'menu' ? (
            <Text>
              <Text dimColor>
                {'  '}
                {APP_VERSION}{' '}
              </Text>
              <Text color="cyan">{APP_CODENAME}</Text>
            </Text>
          ) : (
            subtitle && (
              <Text dimColor>
                {'  '}
                {subtitle}
              </Text>
            )
          )}
        </Text>
      </Box>
      <Box flexShrink={0} maxWidth="70%" columnGap={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text bold wrap="truncate-end">
            {name}
          </Text>
        </Box>
        <Box flexShrink={0} maxWidth="45%">
          <Text dimColor wrap="truncate-end">
            · {roles}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>· {formattedTime} МСК</Text>
        </Box>
      </Box>
    </Box>
  );
}
