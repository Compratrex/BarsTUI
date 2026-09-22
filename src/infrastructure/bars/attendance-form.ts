import type { Attendance, Lesson } from '../../domain/models.js';
import {
  clean,
  isCourseProjectLesson,
  normalize,
  subjectName,
} from '../../domain/lesson-identity.js';

export type FormSnapshot = {
  action: string;
  fields: [string, string][];
  groups: {
    AttendanceSheetID: string;
    Show: string;
    Checked: boolean;
    Students: { StudentID: string; LessonSkipReasonID?: number }[];
  }[];
};
export type FormOption = { value: string; text: string; disabled?: boolean };

export function selectAttendanceSheet(
  options: FormOption[],
  lesson: Pick<Lesson, 'subject' | 'type'>,
): FormOption {
  let candidates = options.filter(
    (option) =>
      option.value &&
      !option.disabled &&
      normalize(subjectName(option.text)) === normalize(subjectName(lesson.subject)),
  );
  const qualification = (text: string) => normalize(clean(text).slice(subjectName(text).length));
  if (qualification(lesson.subject)) {
    candidates = candidates.filter(
      (option) => qualification(option.text) === qualification(lesson.subject),
    );
  } else if (isCourseProjectLesson(lesson.type)) {
    candidates = candidates.filter((option) => /защита.*КП\s*\/\s*КР/i.test(option.text));
  } else if (candidates.length > 1) {
    candidates = candidates.filter((option) => !/защита|КП\s*\/\s*КР/i.test(option.text));
  }
  if (candidates.length !== 1)
    throw new Error(`Не удалось однозначно выбрать лист для «${lesson.subject}» (${lesson.type}).`);
  return candidates[0];
}

export function sameAttendance(left: Attendance, right: Attendance): boolean {
  const signature = (value: Attendance) =>
    value.students
      .map((student) => `${student.id}:${student.present}:${student.skipReason ?? ''}`)
      .sort()
      .join('|');
  return signature(left) === signature(right);
}

export function attendancePayload(
  snapshot: FormSnapshot,
  original: Attendance,
  selected: Set<string>,
): URLSearchParams {
  const known = new Map(original.students.map((student) => [student.id, student]));
  const groups = structuredClone(snapshot.groups);
  for (const group of groups)
    for (const student of group.Students) {
      const id = `${group.AttendanceSheetID}:${student.StudentID}`;
      const before = known.get(id);
      if (!before) throw new Error('Список студентов изменился. Открой пару заново.');
      if (selected.has(id)) delete student.LessonSkipReasonID;
      else
        student.LessonSkipReasonID = !before.present && before.skipReason ? before.skipReason : 1;
    }
  for (const id of selected)
    if (!known.has(id)) throw new Error('В выборе есть студент, которого нет в этой паре.');
  const form = new URLSearchParams(snapshot.fields);
  form.set(
    'AttendanceSheetLessonStudentListSerialized',
    JSON.stringify({ AttendanceSheetLessonStudents: groups }),
  );
  return form;
}
