import { useEffect, useRef, useState } from 'react';

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
  return /locator\.|apiRequestContext\.|page\.|browserType\./.test(message)
    ? 'БАРС не ответил вовремя или изменил форму. Попробуй ещё раз.'
    : message;
}

/** Serializes BARS actions and keeps late responses from updating an unmounted UI. */
export function useOperation(onSessionExpired: () => void) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function clearFeedback() {
    setError('');
    setNotice('');
  }

  async function run(label: string, work: () => Promise<void>) {
    if (inFlight.current || !alive.current) return;
    inFlight.current = true;
    setBusy(label);
    clearFeedback();

    try {
      await work();
    } catch (error) {
      if (alive.current) {
        setError(errorMessage(error));
        if (error instanceof Error && error.name === 'SessionExpiredError') onSessionExpired();
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy('');
    }
  }

  return {
    busy,
    error,
    notice,
    setBusy,
    setError,
    setNotice,
    clearFeedback,
    run,
    isAlive: () => alive.current,
    isRunning: () => inFlight.current,
    dispose: () => {
      alive.current = false;
    },
  };
}

export type Operation = ReturnType<typeof useOperation>;
