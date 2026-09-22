import { useEffect, useRef, useState } from 'react';
import {
  AuthFlowError,
  type AuthFlow,
  type AuthStep,
  type AuthSuccess,
} from '../../features/auth/contracts.js';
import { unlockMessage } from '../../features/auth/messages.js';
import type { UserProfile } from '../../domain/models.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

type Options = {
  auth: AuthFlow;
  autoLogin: boolean;
  navigation: Navigation;
  operation: Operation;
  onAuthenticated: (result: AuthSuccess) => Promise<void>;
};

export function useAuthentication({
  auth,
  autoLogin,
  navigation,
  operation,
  onAuthenticated,
}: Options) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [challengeMessage, setChallengeMessage] = useState('');
  const restoreStarted = useRef(-1);

  useEffect(() => () => auth.dispose(), [auth]);

  async function finish(result: AuthStep) {
    if (!operation.isAlive()) return;

    switch (result.status) {
      case 'login':
        navigation.setScreen('login');
        break;
      case 'two-factor':
        setChallengeMessage(result.message);
        operation.setError(result.error ?? '');
        navigation.setScreen('two-factor');
        break;
      case 'authenticated':
        setProfile(result.profile ?? null);
        await onAuthenticated(result);
        break;
    }
  }

  useEffect(() => {
    const attempt = navigation.restoreAttempt;
    if (!auth.canRestore || (!autoLogin && attempt === 0) || restoreStarted.current === attempt)
      return;
    restoreStarted.current = attempt;

    void operation.run('Проверяем сохранённую сессию…', async () => {
      try {
        await finish(
          await auth.restore((phase) => {
            if (!operation.isAlive()) return;
            operation.setBusy(
              phase === 'unlock'
                ? 'Подтверди вход через Touch ID…'
                : phase === 'login'
                  ? 'Входим с сохранёнными данными…'
                  : 'Проверяем сохранённую сессию…',
            );
          }),
        );
      } catch (error) {
        if (!operation.isAlive()) return;
        if (error instanceof AuthFlowError) {
          navigation.setScreen(error.screen);
          if (error.unlockStatus) {
            operation.setError(unlockMessage[error.unlockStatus]);
            return;
          }
        } else {
          navigation.setScreen('restore-error');
        }
        throw error;
      }
    });
  }, [auth, autoLogin, navigation.restoreAttempt]);

  function manualLogin() {
    auth.cancelChallenge();
    operation.setError('');
    navigation.setScreen('login');
  }

  return {
    profile,
    challengeMessage,
    manualLogin,
    login: (account: string, password: string) =>
      operation.run('Входим…', async () => {
        await finish(await auth.login(account, password));
      }),
    verifyCode: (code: string) =>
      operation.run('Проверяем код…', async () => {
        await finish(await auth.verifyTwoFactor(code));
      }),
  };
}
