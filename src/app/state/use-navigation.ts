import { useState } from 'react';
import type { Screen } from '../navigation.js';

export function useNavigation(restoreOnStart: boolean) {
  const [screen, setScreen] = useState<Screen>(restoreOnStart ? 'restore' : 'login');
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  function retryRestore() {
    setScreen('restore');
    setRestoreAttempt((attempt) => attempt + 1);
  }

  return { screen, setScreen, restoreAttempt, retryRestore };
}

export type Navigation = ReturnType<typeof useNavigation>;
