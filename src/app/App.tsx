import { Box } from 'ink';
import { useTerminalSize } from '../shared/hooks/use-terminal-size.js';
import { AppContent } from './AppContent.js';
import { AppHeader } from './components/AppHeader.js';
import { isAuthenticatedScreen } from './navigation.js';
import { useAppModel, type AppModel } from './use-app-model.js';
import type { AppProps } from './types.js';

function headerSubtitle(app: AppModel): string | undefined {
  switch (app.navigation.screen) {
    case 'groups':
      return app.groups.selected?.name;
    case 'mail':
      return 'mail.mpei.ru';
    case 'schedule':
      return app.schedule.week?.groupName;
    case 'grades':
      return app.grades.summary?.semester.title;
    case 'integrity':
      return app.integrity.report?.journal.title;
    default:
      return app.attendance.journal?.title;
  }
}

export function App(props: AppProps) {
  const app = useAppModel(props);
  const size = useTerminalSize();
  const { screen } = app.navigation;

  return (
    <Box
      width={size.columns}
      height={Math.max(12, size.rows - 1)}
      flexDirection="column"
      paddingX={2}
    >
      {isAuthenticatedScreen(screen) && (
        <AppHeader
          screen={screen}
          subtitle={headerSubtitle(app)}
          profile={app.authentication.profile}
          time={app.time}
        />
      )}
      <AppContent app={app} size={size} />
    </Box>
  );
}
