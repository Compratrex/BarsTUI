import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { IntegrityRepairController } from '../../features/integrity/integrity-repair.js';
import type { IntegrityGateway, IntegrityReport } from '../../domain/models.js';
import type { Clock } from '../../shared/hooks/use-clock.js';
import type { Navigation } from '../state/use-navigation.js';
import type { Operation } from '../state/use-operation.js';

export function useIntegrity(
  client: IntegrityGateway,
  now: Clock,
  navigation: Navigation,
  operation: Operation,
) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [showRepair, setShowRepair] = useState(false);
  const [instant, setInstant] = useState(false);
  const controller = useMemo(() => new IntegrityRepairController(client), [client]);
  const repairState = useSyncExternalStore(controller.subscribe, controller.snapshot);

  useEffect(() => () => controller.stop(), [controller]);

  function open() {
    return operation.run('Загружаем расписание и журнал…', async () => {
      const result = await client.loadIntegrity(now());
      if (!operation.isAlive()) return;
      setReport(result);
      setShowRepair(false);
      setInstant(false);
      navigation.setScreen('integrity');
    });
  }

  function repair() {
    if (!report || operation.isRunning()) return;
    setShowRepair(true);
    setInstant(true);
    return operation.run('Исправляем нарушения…', async () => {
      await controller.run(report, now);
      const result = await client.loadIntegrity(now());
      if (operation.isAlive()) setReport(result);
    });
  }

  return {
    report,
    showRepair,
    instant,
    repairState,
    open,
    repair,
    reset: () => setReport(null),
    stop: () => controller.stop(),
    closeRepair: () => setShowRepair(false),
  };
}
