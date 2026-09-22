import { useState } from 'react';
import type { BarsDataClient, WeekSchedule } from '../../domain/models.js';
import { shiftDate } from '../../domain/time.js';
import type { Clock } from '../../shared/hooks/use-clock.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

export function useSchedule(
  client: Pick<BarsDataClient, 'loadSchedule'>,
  now: Clock,
  navigation: Navigation,
  operation: Operation,
) {
  const [week, setWeek] = useState<WeekSchedule | null>(null);

  function open(date: Date) {
    return operation.run('Загружаем расписание…', async () => {
      const result = await client.loadSchedule(date);
      if (!operation.isAlive()) return;
      setWeek(result);
      navigation.setScreen('schedule');
    });
  }

  return {
    week,
    reset: () => setWeek(null),
    current: () => open(now()),
    reload: () => week && open(new Date(`${week.startDate}T12:00:00+03:00`)),
    navigate: (direction: -1 | 1) =>
      week && open(new Date(`${shiftDate(week.startDate, direction * 7)}T12:00:00+03:00`)),
  };
}
