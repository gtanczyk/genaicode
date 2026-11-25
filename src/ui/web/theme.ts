import { useEffect, useState } from 'react';

/** Where the theme chosen in Settings is kept. Nothing there: the window follows the system. */
export const THEME_KEY = 'genaicode-theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The theme chosen earlier in this browser; `system` when none was, or storage is blocked. */
export function readTheme(store?: Store): ThemeChoice {
  try {
    const kept = (store ?? localStorage).getItem(THEME_KEY);
    return kept === 'light' || kept === 'dark' ? kept : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Puts the choice on the document: `data-gc-theme` on `<html>` forces light or dark for the page's
 * own colors and the design tokens; without it both follow `prefers-color-scheme`. The attribute is
 * this app's own: a page that embeds `<AgentChat>` and sets `data-theme` on its `<html>` for its own
 * styles does not change the chat's tokens.
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'system') delete root.dataset.gcTheme;
  else root.dataset.gcTheme = choice;
}

/** The theme of the window and how to change it. The choice is kept for the next visit. */
export function useTheme(store?: Store): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(() => readTheme(store));
  useEffect(() => applyTheme(choice), [choice]);
  return [
    choice,
    (next) => {
      try {
        if (next === 'system') (store ?? localStorage).removeItem(THEME_KEY);
        else (store ?? localStorage).setItem(THEME_KEY, next);
      } catch {
        // Storage blocked: the choice lasts until the page is closed.
      }
      setChoice(next);
    },
  ];
}
