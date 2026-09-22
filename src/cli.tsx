#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app/App.js';
import { BarsClient } from './infrastructure/bars/bars-client.js';
import { AuthService } from './features/auth/auth-service.js';
import { createAuthServices } from './infrastructure/auth/auth-services.js';
import { OwaMailClient } from './infrastructure/mail/owa-client.js';
import { APP_VERSION, APP_CODENAME } from './app/app-info.js';

const { authStore, sessionUnlock } = createAuthServices();

if (process.argv.includes('--version')) {
  console.log(`Bars Helper ${APP_VERSION} ${APP_CODENAME}`);
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    `Bars Helper ${APP_VERSION} ${APP_CODENAME}\n\nЗапуск: Bars Helper.command (macOS) / Bars Helper.cmd (Windows)\n\n  --login               Войти заново\n  --forget-credentials  Удалить сохранённые данные входа\n  --version             Показать версию\n  --self-test           Проверить сборку без входа в БАРС\n  --help                Показать эту справку\n\nГруппа выбирается после входа; сменить её можно в главном меню.`,
  );
} else if (process.argv.includes('--self-test')) {
  try {
    await (await import('./app/self-test.js')).selfTest();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Ошибка проверки сборки.');
    process.exitCode = 1;
  }
} else if (process.argv.includes('--forget-credentials')) {
  if (!authStore) {
    console.error('Сохранение данных входа доступно в macOS и Windows.');
    process.exitCode = 1;
  } else {
    try {
      const removed = await authStore.clear();
      console.log(
        removed
          ? 'Сохранённые сессия, логин и пароль БАРСа удалены. При следующем запуске введи данные заново.'
          : 'Сохранённых данных входа БАРСа нет.',
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Не удалось удалить сохранённые данные.',
      );
      process.exitCode = 1;
    }
  }
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Запусти Bars Helper в обычном терминале. Для TUI нужен интерактивный терминал.');
  process.exitCode = 1;
} else {
  const client = new BarsClient();
  const auth = new AuthService(client, authStore, sessionUnlock);
  const mail = new OwaMailClient(auth);
  const app = render(
    <App client={client} mail={mail} auth={auth} autoLogin={!process.argv.includes('--login')} />,
    { alternateScreen: true, exitOnCtrlC: false },
  );
  const stop = () => app.unmount();
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  try {
    await app.waitUntilExit();
  } finally {
    mail.close();
    await auth.close();
    process.off('SIGTERM', stop);
    process.off('SIGHUP', stop);
  }
}
