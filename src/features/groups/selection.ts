import type { StudyGroup, StudyGroupSelection } from '../../domain/models.js';

export function sameGroup(left: StudyGroupSelection, right: StudyGroupSelection): boolean {
  return left.id === right.id && left.studentId === right.studentId;
}

export function preferredGroup(
  groups: StudyGroup[],
  saved?: StudyGroupSelection,
): StudyGroup | null {
  return (
    (saved && groups.find((group) => sameGroup(group, saved))) ||
    (groups.length === 1 ? groups[0] : null)
  );
}

export function groupScope(account: string | null, group: StudyGroupSelection): string | null {
  return account ? JSON.stringify([account, group.id, group.studentId]) : null;
}
