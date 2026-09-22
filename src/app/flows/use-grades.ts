import { useState } from 'react';
import type { BarsDataClient, GradesSummary } from '../../domain/models.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

export function useGrades(
  client: Pick<BarsDataClient, 'loadGrades'>,
  navigation: Navigation,
  operation: Operation,
) {
  const [summary, setSummary] = useState<GradesSummary | null>(null);

  function open(semesterId?: string) {
    return operation.run('Загружаем оценки…', async () => {
      const result = await client.loadGrades(semesterId);
      if (!operation.isAlive()) return;
      setSummary(result);
      navigation.setScreen('grades');
    });
  }

  function navigate(direction: -1 | 1) {
    if (!summary) return;
    const index = summary.semesters.findIndex((item) => item.id === summary.semester.id);
    const target = summary.semesters[index - direction];
    if (target) return open(target.id);
    operation.setError('');
    operation.setNotice(
      direction < 0 ? 'Более ранних семестров нет.' : 'Более поздних семестров нет.',
    );
  }

  return {
    summary,
    open,
    navigate,
    reset: () => setSummary(null),
    reload: () => open(summary?.semester.id),
  };
}
