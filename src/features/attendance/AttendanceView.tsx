import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Lesson } from '../../domain/models.js';
import { displayDate } from '../../domain/time.js';
import { changed, type Draft } from './attendance-controller.js';

import { StatusBadge } from './StatusBadge.js';

function PresenceMark({ present }: { present: boolean }) {
  return (
    <Text>
      [<Text color="green">{present ? 'x' : ' '}</Text>]
    </Text>
  );
}

export function AttendanceView({
  lesson,
  draft,
  height,
  busy,
  backToList,
  onToggle,
  onSelectAll,
  onSave,
  onNavigate,
  onList,
  onBack,
  onCurrent,
  onReload,
}: {
  lesson: Lesson | null;
  draft: Draft | null;
  height: number;
  busy: boolean;
  backToList: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSave: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onList: () => void;
  onBack: () => void;
  onCurrent: () => void;
  onReload: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [action, setAction] = useState(-1);
  const students = draft?.original.students ?? [];
  const actions = [
    '← Предыдущая',
    'Следующая →',
    'К списку пар',
    ...(lesson && draft?.original.editable ? ['Отметить [Ctrl+S]'] : []),
  ];
  const activate = (index: number) => {
    if (index === 0) onNavigate(-1);
    if (index === 1) onNavigate(1);
    if (index === 2) onList();
    if (index === 3) onSave();
  };
  const visibleCount = Math.max(1, height - 9);
  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), students.length - visibleCount),
  );
  useInput((input, key) => {
    if (busy) return;
    if (key.escape) onBack();
    else if (key.ctrl && input === 's') onSave();
    else if (!key.ctrl && !key.meta && /^[aф]$/i.test(input) && draft?.original.editable)
      onSelectAll();
    else if (input === 'l' || input === 'д') onList();
    else if (input === 't' || input === 'е') onCurrent();
    else if (input === 'r' || input === 'к') onReload();
    else if (key.tab) setAction((value) => (value + 1) % actions.length);
    else if (key.leftArrow) {
      if (action >= 0) setAction((value) => Math.max(0, value - 1));
      else onNavigate(-1);
    } else if (key.rightArrow) {
      if (action >= 0) setAction((value) => Math.min(actions.length - 1, value + 1));
      else onNavigate(1);
    } else if (key.upArrow) {
      setAction(-1);
      setCursor((value) => Math.max(0, value - 1));
    } else if (key.downArrow) {
      setAction(-1);
      setCursor((value) => Math.min(Math.max(0, students.length - 1), value + 1));
    } else if (key.pageUp) setCursor((value) => Math.max(0, value - visibleCount));
    else if (key.pageDown)
      setCursor((value) => Math.min(students.length - 1, value + visibleCount));
    else if (key.return && action >= 0) activate(action);
    else if (
      (key.return || input === ' ') &&
      action < 0 &&
      students[cursor] &&
      draft?.original.editable
    )
      onToggle(students[cursor].id);
  });
  return (
    <Box flexDirection="column" flexGrow={1}>
      {lesson ? (
        <>
          <Box columnGap={1}>
            <Box flexShrink={1} minWidth={0}>
              <Text bold color="cyan" wrap="truncate-middle">
                {lesson.subject}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <StatusBadge status={lesson.status} />
            </Box>
          </Box>
          <Text>
            {displayDate(lesson.date)} || {lesson.start}–{lesson.end} || {lesson.pair} пара ||{' '}
            {lesson.type}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {!draft?.original.editable && (
              <Box marginBottom={1}>
                <Text>{draft?.original.reason ?? 'Загружаем студентов…'}</Text>
              </Box>
            )}
            {students.slice(offset, offset + visibleCount).map((student, index) => (
              <Box key={student.id} columnGap={1}>
                <Box flexShrink={0}>
                  <PresenceMark present={draft?.selected.has(student.id) ?? false} />
                </Box>
                <Box flexShrink={1} minWidth={0}>
                  <Text
                    inverse={index + offset === cursor && action < 0}
                    color={index + offset === cursor && action < 0 ? 'cyan' : undefined}
                    wrap="truncate-end"
                  >
                    {student.name}
                  </Text>
                </Box>
              </Box>
            ))}
            {draft && students.length === 0 && <Text dimColor>Список студентов пуст.</Text>}
          </Box>
          <Box flexGrow={1} />
          {draft && (
            <Text dimColor>
              Присутствовали: {draft.selected.size} / {students.length}
              {changed(draft) ? ' · Есть несохранённые изменения' : ''}
            </Text>
          )}
        </>
      ) : (
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text bold>Текущей пары нет</Text>
          <Text dimColor>Выбери предыдущую, следующую или открой список пар.</Text>
        </Box>
      )}
      <Box marginTop={1} flexWrap="wrap" columnGap={2}>
        {actions.map((label, index) => (
          <Text key={label} color="cyan" inverse={index === action}>
            [{label}]
          </Text>
        ))}
      </Box>
      {lesson && students.length > 0 && (
        <Text>
          <PresenceMark present /> — присутствовал · <PresenceMark present={false} /> — отсутствовал
        </Text>
      )}
      <Text dimColor wrap="truncate-end">
        ↑↓ студент · Enter отметить / нажать{lesson && draft?.original.editable ? ' · A все' : ''} ·
        Tab кнопки
      </Text>
      <Text dimColor wrap="truncate-end">
        ←→ пары · L список · T текущая · R обновить · Esc {backToList ? 'список' : 'меню'}
      </Text>
    </Box>
  );
}
