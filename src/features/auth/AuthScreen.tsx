import { Box, Text } from 'ink';
import { Loader } from '../../shared/ui/Loader.js';
import { Login } from './LoginForm.js';
import { TwoFactor } from './TwoFactorForm.js';
import type { AuthenticationScreen } from './contracts.js';

type Props = {
  screen: AuthenticationScreen;
  busy: string;
  error: string;
  challengeMessage: string;
  onLogin: (account: string, password: string) => void;
  onCode: (code: string) => Promise<void>;
  onBack: () => void;
};

export function AuthScreen({
  screen,
  busy,
  error,
  challengeMessage,
  onLogin,
  onCode,
  onBack,
}: Props) {
  switch (screen) {
    case 'restore':
      return <Loader label={busy || 'Читаем сохранённый вход…'} />;
    case 'restore-error':
      return (
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text color="red">{error}</Text>
          <Text dimColor>Enter / R — повторить проверку · Esc — войти заново</Text>
        </Box>
      );
    case 'unlock-error':
      return (
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text bold color="cyan">
            БАРС · Touch ID
          </Text>
          <Box marginY={1}>
            <Text color="yellow">{error}</Text>
          </Box>
          <Text dimColor>Enter / R — повторить · Esc — войти в БАРС заново</Text>
          <Text dimColor>Ctrl+C — выход</Text>
        </Box>
      );
    case 'login':
      return <Login busy={busy} error={error} onLogin={onLogin} />;
    case 'two-factor':
      return (
        <TwoFactor
          busy={busy}
          error={error}
          message={challengeMessage}
          onSubmit={onCode}
          onBack={onBack}
        />
      );
  }
}
