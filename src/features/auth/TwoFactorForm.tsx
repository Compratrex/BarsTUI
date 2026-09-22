import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Loader } from '../../shared/ui/Loader.js';

export function TwoFactor({
  busy,
  message,
  error,
  onSubmit,
  onBack,
}: {
  busy: string;
  message: string;
  error: string;
  onSubmit: (code: string) => Promise<void>;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const submitting = useRef(false);
  const submit = async (value: string) => {
    if (busy || submitting.current || !/^\d{4}$/.test(value)) return;
    submitting.current = true;
    setCode('');
    try {
      await onSubmit(value);
    } finally {
      submitting.current = false;
    }
  };
  useInput((_input, key) => {
    if (key.escape && !busy) onBack();
  });
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
            БАРС · Подтверждение входа
          </Text>
        </Box>
        <Text>{message}</Text>
        <Box marginY={1}>
          <Text color="cyan">[Код]: </Text>
          <TextInput
            value={code}
            onChange={(input) => {
              if (busy || submitting.current) return;
              const value = input.replace(/\s/g, '');
              if (!/^\d{0,4}$/.test(value)) return;
              setCode(value);
              if (value.length === 4) void submit(value);
            }}
            mask="•"
            focus={!busy}
            onSubmit={() => {
              void submit(code);
            }}
          />
        </Box>
        {busy ? (
          <Loader label={busy} compact />
        ) : (
          <Text dimColor>4 цифры — отправка автоматически · Esc — к логину</Text>
        )}
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
