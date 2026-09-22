import type { Attendance, AttendanceGateway, Journal, Lesson } from '../../domain/models.js';
import { lessonKey } from '../../domain/lesson-identity.js';

export type Draft = { original: Attendance; selected: Set<string> };
const selection = (attendance: Attendance) =>
  new Set(attendance.students.filter((student) => student.present).map((student) => student.id));
export const changed = (draft: Draft) =>
  draft.original.students.some((student) => student.present !== draft.selected.has(student.id));
type State = {
  journal: Journal | null;
  lessons: Lesson[];
  lesson: Lesson | null;
  drafts: Map<string, Draft>;
};
const empty = (): State => ({ journal: null, lessons: [], lesson: null, drafts: new Map() });
const sameLesson = (previous: Lesson, fresh: Lesson) =>
  previous.journalId === fresh.journalId &&
  (previous.id
    ? previous.id === fresh.id
    : lessonKey(previous) === lessonKey(fresh) &&
      previous.start === fresh.start &&
      previous.end === fresh.end);

export class AttendanceController {
  private state = empty();
  private account: string | null = null;
  private accounts = new Map<string, State>();
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly gateway: AttendanceGateway) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(value: Partial<State>) {
    this.state = { ...this.state, ...value };
    if (this.account) this.accounts.set(this.account, this.state);
    this.listeners.forEach((listener) => listener());
  }
  activate(account: string | null): boolean {
    const sameAccount = !!account && this.account === account;
    this.generation++;
    this.account = account;
    this.state = account ? (this.accounts.get(account) ?? empty()) : empty();
    this.listeners.forEach((listener) => listener());
    return sameAccount;
  }
  get hasChanges() {
    return [...this.accounts.values(), this.state].some((state) =>
      [...state.drafts.values()].some(changed),
    );
  }
  async loadLessons(now: Date) {
    const generation = this.generation;
    let result = await this.gateway.loadLessons(now);
    if (generation === this.generation) {
      // Preserve the UI/draft key when a scheduled lesson gets a journal ID.
      result = {
        ...result,
        lessons: result.lessons.map((fresh) => {
          const matches = this.state.lessons.filter((previous) => sameLesson(previous, fresh));
          if (
            matches.length !== 1 ||
            result.lessons.filter((item) => sameLesson(matches[0], item)).length !== 1
          )
            return fresh;
          return { ...fresh, key: matches[0].key };
        }),
      };
      this.update(result);
    }
    return result;
  }
  async openLesson(target: Lesson | null, discard = false) {
    if (!target) {
      this.update({ lesson: null });
      return;
    }
    const generation = this.generation;
    const attendance = await this.gateway.loadAttendance(target);
    if (generation !== this.generation) return;
    const drafts = new Map(this.state.drafts);
    const draft = drafts.get(target.key);
    if (discard || !draft || !changed(draft))
      drafts.set(target.key, { original: attendance, selected: selection(attendance) });
    this.update({ lesson: target, drafts });
  }
  async reload(now: Date) {
    const generation = this.generation;
    const target = this.state.lesson;
    if (!target) return;
    // A timed-out creation may already exist in the journal; resolve its ID before readback.
    const { lessons } = await this.loadLessons(now);
    if (generation !== this.generation) return;
    const fresh = lessons.find((item) => item.key === target.key);
    if (!fresh) throw new Error('Пары больше нет в расписании и журнале. Открой список пар.');
    await this.openLesson(fresh, true);
  }
  private edit(change: (draft: Draft) => Set<string>) {
    const lesson = this.state.lesson;
    const draft = lesson && this.state.drafts.get(lesson.key);
    if (!lesson || !draft?.original.editable) return;
    this.update({
      drafts: new Map(this.state.drafts).set(lesson.key, { ...draft, selected: change(draft) }),
    });
  }
  toggle(id: string) {
    this.edit((draft) => {
      const selected = new Set(draft.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return selected;
    });
  }
  selectAll() {
    this.edit((draft) => new Set(draft.original.students.map((student) => student.id)));
  }
  async save() {
    const lesson = this.state.lesson;
    const draft = lesson && this.state.drafts.get(lesson.key);
    if (!lesson || !draft?.original.editable || !draft.original.students.length) return;
    const generation = this.generation;
    const saved = await this.gateway.saveAttendance(
      lesson,
      draft.original,
      new Set(draft.selected),
    );
    if (generation !== this.generation) return;
    this.update({
      lesson: saved.lesson,
      lessons: this.state.lessons.map((item) => (item.key === lesson.key ? saved.lesson : item)),
      drafts: new Map(this.state.drafts).set(lesson.key, {
        original: saved.attendance,
        selected: selection(saved.attendance),
      }),
    });
    return saved.attendance;
  }
}
