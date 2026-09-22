import { useEffect, useState } from 'react';

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export function useClock(now: Clock) {
  const [time, setTime] = useState(now);

  useEffect(() => {
    const timer = setInterval(() => setTime(now()), 30_000);
    return () => clearInterval(timer);
  }, [now]);

  return time;
}
