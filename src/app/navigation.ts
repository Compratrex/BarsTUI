import type { AuthenticationScreen } from '../features/auth/contracts.js';

export const menuItems = [
  { id: 'attendance', label: 'Посещаемость' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'grades', label: 'Оценки' },
  { id: 'mail', label: 'Почта' },
  { id: 'lessons', label: 'Все пары' },
  { id: 'integrity', label: 'Проверка целостности' },
  { id: 'groups', label: 'Сменить группу' },
] as const;
export type MenuPage = (typeof menuItems)[number]['id'];
export type AuthenticatedScreen = MenuPage | 'menu';
export type Screen = AuthenticatedScreen | AuthenticationScreen;
export function isAuthenticatedScreen(screen: Screen): screen is AuthenticatedScreen {
  return screen === 'menu' || menuItems.some((item) => item.id === screen);
}
export const pageTitles: Record<MenuPage | 'menu', string> = {
  menu: 'МЭИ',
  attendance: 'Посещаемость',
  schedule: 'Расписание',
  grades: 'Оценки',
  mail: 'Почта',
  lessons: 'Все пары',
  integrity: 'Целостность',
  groups: 'Группы',
};
