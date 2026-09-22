import { Box, Text, useAnimation, useIsScreenReaderEnabled, useStdout } from 'ink';

// One complete trip out and back. Cosine easing slows the block at each turn.
const PERIOD_MS = 3_200;

export function loaderFrame(width: number, elapsedMs: number): string {
  const headWidth = Math.max(2, Math.round(width / 12));
  const phase = ((elapsedMs % PERIOD_MS) / PERIOD_MS) * Math.PI * 2;
  const head = Math.round(((1 - Math.cos(phase)) / 2) * (width - headWidth));
  const movingRight = Math.sin(phase) >= 0;
  const tailLength = Math.round(2 + (Math.abs(Math.sin(phase)) * width) / 6);
  return Array.from({ length: width }, (_, column) => {
    if (column >= head && column < head + headWidth) return '█';
    const distance = movingRight ? head - column : column - (head + headWidth - 1);
    if (distance <= 0 || distance > tailLength) return '░';
    const density = 1 - distance / (tailLength + 1);
    return density > 0.65 ? '▓' : density > 0.25 ? '▒' : '░';
  }).join('');
}

export function Loader({ label, compact = false }: { label: string; compact?: boolean }) {
  const { stdout } = useStdout();
  const screenReader = useIsScreenReaderEnabled();
  const { time } = useAnimation({ interval: 40, isActive: !screenReader });
  const width = Math.max(
    4,
    Math.min(compact ? 32 : 60, (stdout.columns || 80) - (compact ? 16 : 8)),
  );
  const line = loaderFrame(width, time);
  const title = label.replace(/[.…]+$/u, '').trimEnd();
  // Uneven beats: a short second step, then a longer pause on the full ellipsis.
  const dotPhase = time % 1_580;
  const dots = '.'.repeat(dotPhase < 420 ? 1 : dotPhase < 680 ? 2 : 3);
  return (
    <Box
      width="100%"
      flexGrow={compact ? 0 : 1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      {screenReader ? (
        <Text color="cyan">{label}</Text>
      ) : (
        <>
          <Box flexShrink={0} maxWidth="100%" marginBottom={1}>
            <Text color="cyan" wrap="truncate-end">
              {title}
            </Text>
            <Box width={3} flexShrink={0} aria-hidden>
              <Text color="cyan">{dots}</Text>
            </Box>
          </Box>
          <Box height={1} flexShrink={0} aria-hidden>
            <Text color="cyan">{line}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
