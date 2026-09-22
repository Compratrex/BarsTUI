import { useRef, useState } from 'react';
import type { GroupsGateway, StudyGroup } from '../../domain/models.js';
import type { AuthFlow } from '../../features/auth/contracts.js';
import { preferredGroup, sameGroup } from '../../features/groups/selection.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

type Options = {
  client: GroupsGateway;
  auth: AuthFlow;
  navigation: Navigation;
  operation: Operation;
  onChange: (account: string | null, group: StudyGroup | null) => void;
};

export function useGroups({ client, auth, navigation, operation, onChange }: Options) {
  const [items, setItems] = useState<StudyGroup[]>([]);
  const [selected, setSelected] = useState<StudyGroup | null>(null);
  const account = useRef<string | null>(null);

  async function apply(group: StudyGroup) {
    client.selectGroup(group);
    const warning = await auth.rememberGroup(group);
    if (!operation.isAlive()) return;
    setSelected(group);
    onChange(account.current, group);
    if (warning) operation.setError((previous) => [previous, warning].filter(Boolean).join(' '));
    navigation.setScreen('menu');
  }

  async function initialize(identity: string | null) {
    account.current = identity;
    client.clearGroup();
    setItems([]);
    setSelected(null);
    navigation.setScreen('groups');
    operation.setBusy('Загружаем группы…');
    try {
      const groups = await client.loadGroups();
      if (!operation.isAlive()) return;
      setItems(groups);
      const preferred = preferredGroup(groups, auth.selectedGroup);
      if (preferred) await apply(preferred);
      else onChange(identity, null);
    } catch (error) {
      if (!operation.isAlive()) return;
      if (error instanceof Error && error.name === 'SessionExpiredError') throw error;
      onChange(identity, null);
      operation.setError('Не удалось загрузить группы аккаунта. Повтори загрузку через R.');
    }
  }

  function open() {
    operation.clearFeedback();
    navigation.setScreen('groups');
  }

  function reload() {
    return operation.run('Обновляем группы…', async () => {
      const groups = await client.loadGroups();
      if (!operation.isAlive()) return;
      setItems(groups);
      const current = selected && groups.find((group) => sameGroup(group, selected));
      if (!current) {
        setSelected(null);
        onChange(account.current, null);
      } else setSelected(current);
    });
  }

  return {
    items,
    selected,
    initialize,
    open,
    reload,
    choose: (group: StudyGroup) => operation.run('Выбираем группу…', () => apply(group)),
    back: () => {
      if (selected) navigation.setScreen('menu');
    },
  };
}
