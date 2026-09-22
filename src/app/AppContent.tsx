import { Box, Text } from 'ink';
import { AttendanceView } from '../features/attendance/AttendanceView.js';
import { LessonList } from '../features/attendance/LessonList.js';
import { AuthScreen } from '../features/auth/AuthScreen.js';
import { GradesView } from '../features/grades/GradesView.js';
import { IntegrityView } from '../features/integrity/IntegrityView.js';
import { IntegrityRepairView } from '../features/integrity/IntegrityRepairView.js';
import { MailView } from '../features/mail/MailView.js';
import { ScheduleView } from '../features/schedule/ScheduleView.js';
import { Loader } from '../shared/ui/Loader.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { GroupPicker } from '../features/groups/GroupPicker.js';
import { MainMenu } from './components/MainMenu.js';
import { isAuthenticatedScreen } from './navigation.js';
import type { Viewport } from './types.js';
import type { AppModel } from './use-app-model.js';

type Props = { app: AppModel; size: Viewport };

function PageContent({ app, size }: Props) {
  const { navigation, operation, attendance, schedule, grades, integrity, navigate } = app;
  const height = size.rows - 6;
  const columns = size.columns - 4;
  const backToMenu = () => navigate('menu');

  if (navigation.screen === 'integrity' && integrity.showRepair) {
    return (
      <IntegrityRepairView
        state={{
          ...integrity.repairState,
          running: integrity.repairState.running || !!operation.busy,
        }}
        height={height}
        onStop={integrity.stop}
        onBack={integrity.closeRepair}
        onReload={integrity.open}
        onAttendance={attendance.openMissing}
      />
    );
  }
  if (operation.busy) return <Loader label={operation.busy} />;

  switch (navigation.screen) {
    case 'menu':
      return <MainMenu selected={app.menuIndex} group={app.groups.selected} />;
    case 'groups':
      return (
        <GroupPicker
          key={JSON.stringify([app.groups.items, app.groups.selected])}
          groups={app.groups.items}
          selected={app.groups.selected}
          height={height}
          onChoose={app.groups.choose}
          onReload={app.groups.reload}
          onBack={app.groups.back}
        />
      );
    case 'mail':
      return <MailView client={app.mail} columns={columns} height={height} onBack={backToMenu} />;
    case 'integrity':
      return (
        integrity.report && (
          <IntegrityView
            report={integrity.report}
            instant={integrity.instant}
            columns={columns}
            height={height}
            onRepair={integrity.repair}
            onReload={integrity.open}
            onBack={backToMenu}
          />
        )
      );
    case 'grades':
      return (
        grades.summary && (
          <GradesView
            key={grades.summary.semester.id}
            grades={grades.summary}
            columns={columns}
            height={height}
            onSemester={grades.navigate}
            onReload={grades.reload}
            onBack={backToMenu}
          />
        )
      );
    case 'schedule':
      return (
        schedule.week && (
          <ScheduleView
            key={schedule.week.startDate}
            week={schedule.week}
            columns={columns}
            height={height}
            now={app.time}
            onWeek={schedule.navigate}
            onCurrent={schedule.current}
            onReload={schedule.reload}
            onBack={backToMenu}
          />
        )
      );
    case 'lessons':
      return (
        <LessonList
          key={attendance.listStart}
          height={height}
          initial={attendance.listStart}
          items={attendance.lessons}
          animate={attendance.revealLessons}
          onRevealComplete={attendance.finishReveal}
          backLabel={attendance.entry === 'list' ? 'меню' : 'пара'}
          onChoose={attendance.choose}
          onBack={() => navigate(attendance.entry === 'list' ? 'menu' : 'attendance')}
        />
      );
    case 'attendance':
      return (
        <AttendanceView
          key={attendance.lesson?.key ?? 'none'}
          lesson={attendance.lesson}
          draft={attendance.draft}
          height={height - 1}
          busy={!!operation.busy}
          backToList={attendance.entry === 'list'}
          onToggle={attendance.toggle}
          onSelectAll={attendance.selectAll}
          onSave={attendance.save}
          onNavigate={attendance.navigateLesson}
          onList={() => navigate('lessons')}
          onBack={() => navigate(attendance.entry === 'list' ? 'lessons' : 'menu')}
          onCurrent={attendance.current}
          onReload={app.reloadAttendance}
        />
      );
    default:
      return null;
  }
}

export function AppContent({ app, size }: Props) {
  const { confirmation, navigation, operation, authentication } = app;
  if (confirmation) return <ConfirmationDialog action={confirmation} />;
  if (!isAuthenticatedScreen(navigation.screen)) {
    return (
      <AuthScreen
        screen={navigation.screen}
        busy={operation.busy}
        error={operation.error}
        challengeMessage={authentication.challengeMessage}
        onLogin={authentication.login}
        onCode={authentication.verifyCode}
        onBack={authentication.manualLogin}
      />
    );
  }

  return (
    <>
      <PageContent app={app} size={size} />
      <Box height={2} marginTop={1}>
        <Text color={operation.error ? 'red' : 'green'}>
          {operation.error || operation.notice || ' '}
        </Text>
      </Box>
    </>
  );
}
