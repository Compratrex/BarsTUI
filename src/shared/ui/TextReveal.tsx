import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Text, useAnimation, useIsScreenReaderEnabled } from 'ink';

const DURATION_MS = 380;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function useTextReveal(enabled: boolean, onComplete?: () => void) {
  const reader = useIsScreenReaderEnabled();
  const [finished, setFinished] = useState(false);
  const active = enabled && !reader && !finished;
  const { time } = useAnimation({ interval: 30, isActive: active });
  const finish = useCallback(() => {
    setFinished(true);
    onComplete?.();
  }, [onComplete]);
  useEffect(() => {
    if (!enabled || finished) return;
    if (reader) {
      finish();
      return;
    }
    const timer = setTimeout(finish, DURATION_MS);
    return () => clearTimeout(timer);
  }, [enabled, finished, reader, finish]);
  const progress = active ? 1 - (1 - clamp(time / DURATION_MS)) ** 3 : 1;
  return {
    finish,
    line: (index: number, total: number) => clamp((progress * (total + 1) - index) / 2),
  };
}

export function RevealText({
  children,
  progress = 1,
  inverse,
  ...props
}: Omit<ComponentProps<typeof Text>, 'children'> & { children: string; progress?: number }) {
  if (progress >= 1)
    return (
      <Text {...props} inverse={inverse}>
        {children}
      </Text>
    );
  const characters = Array.from(children);
  const count = Math.floor(characters.length * clamp(progress));
  return (
    <Text {...props}>
      <Text inverse={inverse}>{characters.slice(0, count).join('')}</Text>
      {' '.repeat(characters.length - count)}
    </Text>
  );
}
