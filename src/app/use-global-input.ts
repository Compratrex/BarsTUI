import { useInput } from 'ink';
import type { Dispatch, SetStateAction } from 'react';
import { menuItems, type MenuPage, type Screen } from './navigation.js';
import type { Confirmation } from './types.js';

type Options = {
  screen: Screen;
  busy: boolean;
  confirmation: Confirmation | null;
  menuIndex: number;
  setMenuIndex: Dispatch<SetStateAction<number>>;
  menuActions: Record<MenuPage, () => void>;
  requestExit: () => void;
  confirm: () => void;
  cancelConfirmation: () => void;
  retryRestore: () => void;
  manualLogin: () => void;
};

export function useGlobalInput(options: Options) {
  useInput((input, key) => {
    if (options.confirmation) {
      if (key.return) options.confirm();
      else if (key.escape) options.cancelConfirmation();
      return;
    }
    if (key.ctrl && input === 'c') {
      options.requestExit();
      return;
    }
    if (options.busy) return;

    if (options.screen === 'restore-error' || options.screen === 'unlock-error') {
      if (key.return || input === 'r' || input === 'к') options.retryRestore();
      else if (key.escape) options.manualLogin();
      return;
    }
    if (options.screen !== 'menu') return;

    if (key.upArrow || key.downArrow || key.tab) {
      const direction = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      options.setMenuIndex((index) => (index + direction + menuItems.length) % menuItems.length);
    } else if (key.return) {
      options.menuActions[menuItems[options.menuIndex].id]();
    }
  });
}
