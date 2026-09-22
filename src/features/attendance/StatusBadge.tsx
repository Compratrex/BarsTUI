import { RevealText } from '../../shared/ui/TextReveal.js';

export function StatusBadge({ status, progress = 1 }: { status: string; progress?: number }) {
  const normalized = status.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  const color =
    normalized === 'на рассмотрении'
      ? 'yellow'
      : normalized === 'требуется корректировка'
        ? 'red'
        : normalized === 'согласовано'
          ? 'green'
          : 'gray';
  const label = normalized
    ? normalized[0].toLocaleUpperCase('ru-RU') + normalized.slice(1)
    : 'Нет статуса';
  return <RevealText color={color} progress={progress}>{`[ ${label} ]`}</RevealText>;
}
