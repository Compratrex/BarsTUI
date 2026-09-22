import type {
  IntegrityEntry,
  IntegrityGateway,
  IntegrityReport,
  Lesson,
} from '../../domain/models.js';
import { normalize, subjectName } from '../../domain/lesson-identity.js';

export type RepairPlan =
  { kind: 'update'; record: Lesson } | { kind: 'manual'; reason: string; attendance?: Lesson };
export function planIntegrityRepair(entry: IntegrityEntry): RepairPlan {
  if (entry.status !== 'violation') return { kind: 'manual', reason: 'Исправление не требуется.' };
  if (entry.source !== 'schedule')
    return { kind: 'manual', reason: 'Нет однозначной пары в расписании. Проверь запись в БАРСе.' };
  if (!entry.recorded.length)
    return {
      kind: 'manual',
      reason: 'Записи нет. Открой посещаемость и укажи, кто присутствовал.',
      attendance: entry.lesson,
    };
  if (entry.recorded.length !== 1)
    return { kind: 'manual', reason: 'Найдены дубли. Выбери нужную запись в БАРСе.' };
  const record = entry.recorded[0];
  if (!record.id || record.readOnly)
    return { kind: 'manual', reason: 'БАРС не разрешает редактирование этой записи.' };
  if (
    record.date !== entry.lesson.date ||
    normalize(subjectName(record.subject)) !== normalize(subjectName(entry.lesson.subject))
  ) {
    return {
      kind: 'manual',
      reason: 'Различаются дата или предмет. Нужно проверить соответствие записей вручную.',
    };
  }
  return { kind: 'update', record };
}

export type RepairItem = {
  entry: IntegrityEntry;
  status: 'queued' | 'working' | 'fixed' | 'manual' | 'failed';
  message: string;
};
export type RepairState = { items: RepairItem[]; running: boolean; stopping: boolean };
export class IntegrityRepairController {
  private state: RepairState = { items: [], running: false, stopping: false };
  private listeners = new Set<() => void>();
  constructor(private readonly gateway: Pick<IntegrityGateway, 'repairIntegrityEntry'>) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(value: Partial<RepairState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private setItem(index: number, value: Partial<RepairItem>) {
    this.update({
      items: this.state.items.map((item, i) => (i === index ? { ...item, ...value } : item)),
    });
  }
  stop() {
    if (this.state.running) this.update({ stopping: true });
  }
  async run(report: IntegrityReport, now: () => Date) {
    if (this.state.running) return;
    this.update({
      items: report.entries
        .filter((entry) => entry.status === 'violation')
        .map((entry) => ({ entry, status: 'queued', message: '' })),
      running: true,
      stopping: false,
    });
    try {
      for (let index = 0; index < this.state.items.length && !this.state.stopping; index++) {
        const { entry } = this.state.items[index];
        const plan = planIntegrityRepair(entry);
        if (plan.kind === 'manual') {
          this.setItem(index, { status: 'manual', message: plan.reason });
          continue;
        }
        this.setItem(index, {
          status: 'working',
          message: 'Сверяем свежие данные и исправляем запись…',
        });
        try {
          this.setItem(index, await this.gateway.repairIntegrityEntry(entry, now()));
        } catch (error) {
          this.setItem(index, {
            status: 'failed',
            message: error instanceof Error ? error.message : 'Не удалось исправить запись.',
          });
          // A failed or unconfirmed write is never retried automatically.
          throw error;
        }
      }
    } finally {
      this.update({ running: false });
    }
  }
}
