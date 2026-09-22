import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Loader } from '../../shared/ui/Loader.js';

export function Login({
  busy,
  error,
  onLogin,
}: {
  busy: string;
  error: string;
  onLogin: (account: string, password: string) => void;
}) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState(0);
  useInput((_input, key) => {
    if (busy) return;
    if (key.tab || key.upArrow || key.downArrow) setField((value) => 1 - value);
  });
  const submit = () => {
    if (!account.trim()) {
      setField(0);
      return;
    }
    if (!password) {
      setField(1);
      return;
    }
    onLogin(account.trim(), password);
    setPassword('');
  };
  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      <Box
        width={48}
        maxWidth="100%"
        borderStyle="round"
        borderColor="cyan"
        paddingX={3}
        paddingY={1}
        flexDirection="column"
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">
            БАРС · МЭИ
          </Text>
        </Box>
        <Box>
          <Text color={field === 0 ? 'cyan' : undefined}>[Логин]: </Text>
          <TextInput
            value={account}
            onChange={setAccount}
            focus={!busy && field === 0}
            onSubmit={() => setField(1)}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={field === 1 ? 'cyan' : undefined}>[Пароль]: </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            mask="•"
            focus={!busy && field === 1}
            onSubmit={submit}
          />
        </Box>
        <Box marginTop={1}>
          {busy ? (
            <Loader label={busy} compact />
          ) : (
            <Text dimColor>Tab — сменить поле · Enter — войти</Text>
          )}
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
