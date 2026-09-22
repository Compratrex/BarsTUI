export type Journal = {
  id: string;
  title: string;
  href: string;
  startDate: string;
  endDate: string;
};

export type Lesson = {
  key: string;
  id: string | null;
  journalId: string;
  date: string;
  start: string;
  end: string;
  pair: string;
  subject: string;
  type: string;
  status: string;
  readOnly?: boolean;
  location?: string;
  teacher?: string;
};

export type ScheduledLesson = Pick<
  Lesson,
  'key' | 'date' | 'start' | 'end' | 'pair' | 'subject' | 'type' | 'location' | 'teacher'
>;
export type WeekSchedule = {
  groupName: string;
  startDate: string;
  endDate: string;
  lessons: ScheduledLesson[];
};

export type IntegrityEntry = {
  key: string;
  source: 'schedule' | 'record';
  lesson: Lesson;
  recorded: Lesson[];
  status: 'ok' | 'violation' | 'pending';
  details: string[];
};
export type IntegrityReport = { journal: Journal; checkedAt: string; entries: IntegrityEntry[] };
export type IntegrityRepairResult = { status: 'fixed' | 'manual'; message: string };
export interface IntegrityGateway {
  loadIntegrity(now: Date): Promise<IntegrityReport>;
  repairIntegrityEntry(entry: IntegrityEntry, now: Date): Promise<IntegrityRepairResult>;
}

export type GradeSemester = { id: string; title: string };
export type GradeValue = {
  value: string;
  kind: 'grade' | 'missing' | 'text';
  description?: string;
};
export type GradeCell = GradeValue[];
export type GradeSubject = {
  subject: string;
  weeks: GradeCell[];
  total: GradeCell;
  attestation: GradeCell;
  final: GradeCell;
};
export type GradesSummary = {
  semester: GradeSemester;
  semesters: GradeSemester[];
  weeks: { label: string; current: boolean }[];
  subjects: GradeSubject[];
};

export type Student = {
  id: string;
  name: string;
  present: boolean;
  skipReason?: number;
};

export type Attendance = {
  students: Student[];
  editable: boolean;
  reason?: string;
};

export type UserProfile = { account?: string; fullName?: string; roles: string[] };
export type StudyGroup = {
  id: string;
  name: string;
  studentId: string;
  status: string;
};
export type StudyGroupSelection = Pick<StudyGroup, 'id' | 'studentId'>;
export interface GroupsGateway {
  loadGroups(): Promise<StudyGroup[]>;
  selectGroup(group: StudyGroupSelection): void;
  clearGroup(): void;
}
export type AuthenticatedLogin = {
  status: 'authenticated';
  warning?: string;
  profile?: UserProfile;
};
export type SessionRestoreResult = AuthenticatedLogin | { status: 'missing' | 'expired' };
export type LoginResult =
  AuthenticatedLogin | { status: 'two-factor'; message: string; error?: string };

export type SavedAttendance = { lesson: Lesson; attendance: Attendance };

export interface AttendanceGateway {
  loadLessons(now: Date): Promise<{ journal: Journal; lessons: Lesson[] }>;
  loadAttendance(lesson: Lesson): Promise<Attendance>;
  saveAttendance(
    lesson: Lesson,
    original: Attendance,
    selected: Set<string>,
  ): Promise<SavedAttendance>;
}

export interface BarsDataClient extends AttendanceGateway, IntegrityGateway, GroupsGateway {
  loadSchedule(date: Date): Promise<WeekSchedule>;
  loadGrades(semesterId?: string): Promise<GradesSummary>;
}
