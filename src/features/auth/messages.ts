import type { UnlockStatus } from './contracts.js';

export const unlockMessage: Record<Exclude<UnlockStatus, 'authenticated'>, string> = {
  cancelled: 'Проверка Touch ID отменена. Сессия заблокирована.',
  unavailable: 'Touch ID недоступен или отпечаток не настроен. Сессия заблокирована.',
  'locked-out': 'Touch ID временно заблокирован macOS. Разблокируй Mac паролем и повтори попытку.',
  failed: 'Не удалось подтвердить Touch ID. Сессия заблокирована.',
  'setup-error':
    'Не удалось запустить Touch ID. Для первой сборки нужны инструменты разработчика Apple. Можно войти в БАРС заново.',
};
