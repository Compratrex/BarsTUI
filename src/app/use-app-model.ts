import { useState } from 'react';
import type { StudyGroup } from '../domain/models.js';
import { groupScope } from '../features/groups/selection.js';
import { useGroups } from './flows/use-groups.js';
import { useApp } from 'ink';
import type { AuthSuccess } from '../features/auth/contracts.js';
import { systemClock, useClock } from '../shared/hooks/use-clock.js';
import { isAuthenticatedScreen, type MenuPage, type Screen } from './navigation.js';
import { useAttendance } from './flows/use-attendance.js';
import { useAuthentication } from './flows/use-authentication.js';
import { useGrades } from './flows/use-grades.js';
import { useIntegrity } from './flows/use-integrity.js';
import { useSchedule } from './flows/use-schedule.js';
import { useNavigation } from './state/use-navigation.js';
import { useOperation } from './state/use-operation.js';
import { useGlobalInput } from './use-global-input.js';
import type { AppProps, Confirmation } from './types.js';

/** Wires feature flows together; each flow owns its data and actions. */
export function useAppModel({ client, auth, mail, now = systemClock, autoLogin = true }: AppProps) {
  const { exit } = useApp();
  const time = useClock(now);
  const navigation = useNavigation(auth.canRestore && autoLogin);
  const [menuIndex, setMenuIndex] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const operation = useOperation(() => {
    auth.cancelChallenge();
    if (auth.canRestore && isAuthenticatedScreen(navigation.screen)) navigation.retryRestore();
    else navigation.setScreen('login');
  });
  const attendance = useAttendance({ client, now, navigation, operation });
  const schedule = useSchedule(client, now, navigation, operation);
  const grades = useGrades(client, navigation, operation);
  const integrity = useIntegrity(client, now, navigation, operation);

  function changeGroup(account: string | null, group: StudyGroup | null) {
    const restored = attendance.activate(group ? groupScope(account, group) : null);
    schedule.reset();
    grades.reset();
    integrity.reset();
    if (!restored) setMenuIndex(0);
  }
  const groups = useGroups({ client, auth, navigation, operation, onChange: changeGroup });

  async function onAuthenticated(result: AuthSuccess) {
    operation.setError(result.warning ?? '');
    operation.setNotice(result.notice ?? '');
    await groups.initialize(result.accountKey);
    if (attendance.hasChanges)
      operation.setNotice(
        'Вход восстановлен. Черновики сохранены; проверь нужную пару перед отправкой.',
      );
  }

  const authentication = useAuthentication({
    auth,
    autoLogin,
    navigation,
    operation,
    onAuthenticated,
  });

  function navigate(screen: Screen) {
    operation.clearFeedback();
    navigation.setScreen(screen);
  }

  function exitApp() {
    operation.dispose();
    integrity.stop();
    auth.dispose();
    exit();
  }

  function confirm() {
    if (confirmation === 'exit') exitApp();
    else {
      setConfirmation(null);
      void attendance.reload();
    }
  }

  const menuActions: Record<MenuPage, () => void> = {
    attendance: attendance.enterCurrent,
    lessons: attendance.enterList,
    schedule: schedule.current,
    grades: () => grades.open(),
    integrity: integrity.open,
    mail: () => navigate('mail'),
    groups: groups.open,
  };

  useGlobalInput({
    screen: navigation.screen,
    busy: !!operation.busy,
    confirmation,
    menuIndex,
    setMenuIndex,
    menuActions,
    requestExit: () => (attendance.hasChanges ? setConfirmation('exit') : exitApp()),
    confirm,
    cancelConfirmation: () => setConfirmation(null),
    retryRestore: navigation.retryRestore,
    manualLogin: authentication.manualLogin,
  });

  function reloadAttendance() {
    if (attendance.needsReloadConfirmation) setConfirmation('reload');
    else void attendance.reload();
  }

  return {
    navigation,
    operation,
    authentication,
    groups,
    attendance,
    schedule,
    grades,
    integrity,
    time,
    mail,
    menuIndex,
    confirmation,
    navigate,
    reloadAttendance,
  };
}

export type AppModel = ReturnType<typeof useAppModel>;
