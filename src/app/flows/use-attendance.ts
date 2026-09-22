import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { AttendanceController, changed } from '../../features/attendance/attendance-controller.js';
import { sameIntegrityLesson } from '../../features/integrity/integrity.js';
import type { AttendanceGateway, Lesson } from '../../domain/models.js';
import { adjacentLesson, currentLessons, lessonStart } from '../../domain/time.js';
import type { Clock } from '../../shared/hooks/use-clock.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

type Options = {
  client: AttendanceGateway;
  now: Clock;
  navigation: Navigation;
  operation: Operation;
};

export function useAttendance({ client, now, navigation, operation }: Options) {
  const controller = useMemo(() => new AttendanceController(client), [client]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [entry, setEntry] = useState<'current' | 'list'>('current');
  const [revealLessons, setRevealLessons] = useState(false);
  const finishReveal = useCallback(() => setRevealLessons(false), []);
  const { lesson, lessons, drafts } = state;
  const draft = lesson ? (drafts.get(lesson.key) ?? null) : null;

  async function openLesson(target: Lesson | null) {
    await controller.openLesson(target);
    if (operation.isAlive()) navigation.setScreen('attendance');
  }

  async function openCurrent(available = lessons) {
    const current = currentLessons(available, now());
    if (current.length > 1) {
      operation.setNotice('Сейчас несколько занятий. Выбери нужную пару в списке.');
      navigation.setScreen('lessons');
      return;
    }
    await openLesson(current[0] ?? null);
  }

  function enterCurrent() {
    return operation.run('Загружаем пары…', async () => {
      const result = await controller.loadLessons(now());
      if (!operation.isAlive()) return;
      setEntry('current');
      await openCurrent(result.lessons);
    });
  }

  function enterList() {
    return operation.run('Загружаем пары…', async () => {
      await controller.loadLessons(now());
      if (!operation.isAlive()) return;
      setRevealLessons(true);
      setEntry('list');
      navigation.setScreen('lessons');
    });
  }

  function openMissing(target: Lesson) {
    return operation.run('Открываем посещаемость…', async () => {
      const result = await controller.loadLessons(now());
      if (!operation.isAlive()) return;
      const matches = result.lessons.filter((item) => sameIntegrityLesson(item, target));
      if (matches.length !== 1)
        throw new Error('Пара изменилась или найдены дубли. Повтори проверку целостности.');
      setEntry('current');
      await openLesson(matches[0]);
    });
  }

  function save() {
    if (!lesson || !draft?.original.editable || !draft.original.students.length) return;
    return operation.run('Отмечаем', async () => {
      const saved = await controller.save();
      if (operation.isAlive() && saved) {
        operation.setNotice(
          `Посещаемость сохранена · присутствовали ${saved.students.filter((student) => student.present).length} из ${saved.students.length}`,
        );
      }
    });
  }

  function navigateLesson(direction: -1 | 1) {
    const target = adjacentLesson(lessons, lesson, direction, now());
    if (target) return operation.run('Загружаем студентов…', () => openLesson(target));
    operation.setError('');
    operation.setNotice(
      direction === 1
        ? 'Следующих пар в этом семестре нет.'
        : 'Предыдущих пар в этом семестре нет.',
    );
  }

  const preferred = lesson ?? currentLessons(lessons, now())[0];
  const listIndex = lessons.findIndex((item) =>
    preferred ? item.key === preferred.key : lessonStart(item) >= now().getTime(),
  );

  return {
    ...state,
    draft,
    entry,
    revealLessons,
    finishReveal,
    get hasChanges() {
      return controller.hasChanges;
    },
    needsReloadConfirmation: !!draft && changed(draft),
    listStart: listIndex < 0 ? Math.max(0, lessons.length - 1) : listIndex,
    activate: (account: string | null) => controller.activate(account),
    enterCurrent,
    enterList,
    openMissing,
    save,
    navigateLesson,
    choose: (index: number) =>
      operation.run('Загружаем студентов…', () => openLesson(lessons[index])),
    current: () => operation.run('Ищем текущую пару…', () => openCurrent()),
    reload: () => operation.run('Обновляем пару…', () => controller.reload(now())),
    toggle: (id: string) => {
      controller.toggle(id);
      operation.setNotice('');
    },
    selectAll: () => {
      controller.selectAll();
      operation.setNotice('');
    },
  };
}
