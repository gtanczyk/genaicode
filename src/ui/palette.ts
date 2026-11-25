import type { SessionInfo } from '../agents/sessions/group.js';
import { chatTitle, folderName, sessionKey } from './sidebar.js';

/** A command of the window that the palette runs: a place to go, or a switch. */
export interface PaletteCommand {
  /** Stable across renders: what React keys the row by. */
  id: string;
  label: string;
  /** Other words it is found by. */
  keywords?: string;
  /** Its key, as the sidebar shows it (`⌘N`). */
  shortcut?: string;
  run(): void;
}

/** One row of the palette (docs/design/desktop-layout.md, "Search (⌘K)"). */
export type PaletteItem =
  | {
      /** `chat`: one of this app's. `session`: one another agent has, from the session index. */
      kind: 'chat' | 'session';
      key: string;
      title: string;
      /** The folder it ran in: titles repeat across projects. */
      project: string;
      agent: string;
      session: SessionInfo;
    }
  | { kind: 'command'; key: string; title: string; command: PaletteCommand };

export interface PaletteSource {
  /** This app's chats. */
  chats: readonly SessionInfo[];
  /** The sessions this app did not start. */
  sessions: readonly SessionInfo[];
  commands: readonly PaletteCommand[];
  /** The directory of chats started without a folder: they are listed under "Home folder". */
  home?: string;
}

/** No more rows than this: the list is for picking, and the pages list everything. */
export const PALETTE_LIMIT = 50;

const trimDir = (dir: string) => (dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir);

/** The project a session is listed under, as the sidebar names it. */
export function paletteProject(session: Pick<SessionInfo, 'cwd'>, home?: string): string {
  const dir = session.cwd ? trimDir(session.cwd) : undefined;
  if (!dir || (home !== undefined && dir === trimDir(home))) return 'Home folder';
  return folderName(dir);
}

const fold = (text: string) => text.toLowerCase();

/** The words of what was typed. */
export function paletteTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** How well `term` is found in `text`: at its start, at the start of a word, anywhere, or not (0). */
function found(text: string, term: string): number {
  const at = text.indexOf(term);
  if (at < 0) return 0;
  if (at === 0) return 3;
  // A later occurrence may start a word where the first does not.
  for (let index = at; index >= 0; index = text.indexOf(term, index + 1)) {
    if (!/[\p{L}\p{N}]/u.test(text[index - 1]!)) return 2;
  }
  return 1;
}

/** Where a term may be found, the fields that say most first. */
interface Fields {
  title: string;
  /** Project and agent, or a command's other words. */
  label: string;
  /** The first and last prompt. */
  prompt: string;
}

/**
 * How well a row answers the words typed: every word must be somewhere in it, and a word in the
 * title counts for more than one in the project or agent, which counts for more than one in a prompt.
 * 0: the row does not match.
 */
function score(fields: Fields, terms: readonly string[]): number {
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      found(fields.title, term) * 100,
      found(fields.label, term) * 10,
      found(fields.prompt, term) ? 1 : 0,
    );
    if (!best) return 0;
    total += best;
  }
  return total;
}

function fieldsOf(item: PaletteItem): Fields {
  if (item.kind === 'command') {
    return { title: fold(item.title), label: fold(item.command.keywords ?? ''), prompt: '' };
  }
  const { session } = item;
  return {
    title: fold(item.title),
    label: fold(`${item.project} ${item.agent} ${session.branch ?? ''}`),
    prompt: fold(`${session.firstPrompt ?? ''}\n${session.lastPrompt ?? ''}`),
  };
}

/**
 * The rows for what was typed. Nothing typed: this app's chats, the latest first, then the other
 * agents' sessions, then the commands. Else the rows that hold every word, the best match first; a
 * command comes before a chat that matches as well, and of two chats the one worked in last.
 */
export function paletteItems(source: PaletteSource, query: string, limit = PALETTE_LIMIT): PaletteItem[] {
  const seen = new Set<string>();
  const sessions = (list: readonly SessionInfo[], kind: 'chat' | 'session'): PaletteItem[] =>
    [...list]
      .filter((session) => {
        const key = sessionKey(session);
        if (session.archived || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => ({
        kind,
        key: `${kind}:${sessionKey(session)}`,
        title: chatTitle(session),
        project: paletteProject(session, source.home),
        agent: session.agent,
        session,
      }));
  const all: PaletteItem[] = [
    ...sessions(source.chats, 'chat'),
    ...sessions(source.sessions, 'session'),
    ...source.commands.map(
      (command): PaletteItem => ({ kind: 'command', key: `command:${command.id}`, title: command.label, command }),
    ),
  ];
  const terms = paletteTerms(query);
  if (!terms.length) return all.slice(0, limit);
  const order = { command: 0, chat: 1, session: 2 } as const;
  return all
    .map((item, index) => ({ item, index, score: score(fieldsOf(item), terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || order[a.item.kind] - order[b.item.kind] || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.item);
}

/**
 * The row an arrow key moves to from `index` among `count`: one up or down, around the ends; Home
 * and End go to the first and last. Undefined for any other key, and with no rows.
 */
export function paletteMove(key: string, index: number, count: number): number | undefined {
  if (!count) return undefined;
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'PageDown':
      return Math.min(count - 1, index + 8);
    case 'PageUp':
      return Math.max(0, index - 8);
    default:
      return undefined;
  }
}

/** What the window offers, by what it has: the commands are built from this. */
export interface PaletteActions {
  onNewChat(): void;
  onNeedsYou(): void;
  /** How many requests wait, for the label. */
  needs?: number;
  onAllSessions?(): void;
  onAllChats?(): void;
  /** The sections of the Settings page, each opened in its place. */
  settings?: ReadonlyArray<{ label: string; onSelect(): void }>;
  onWhatsNew?(): void;
  onCommands?(): void;
  /** Folds the sidebar to its rail, or back. */
  onToggleSidebar?(): void;
  sidebarCollapsed?: boolean;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mac?: boolean;
}

/**
 * The commands of the palette: the places of the sidebar and its switches, and only those the
 * window has (no session index: no All sessions; a Settings section the page lacks: none here).
 */
export function paletteCommands(actions: PaletteActions): PaletteCommand[] {
  const key = (letter: string) => (actions.mac === false ? `Ctrl+${letter}` : `⌘${letter}`);
  const commands: PaletteCommand[] = [
    { id: 'new-chat', label: 'New chat', keywords: 'start conversation', shortcut: key('N'), run: actions.onNewChat },
    {
      id: 'needs-you',
      label: actions.needs ? `Needs you (${actions.needs})` : 'Needs you',
      keywords: 'approvals questions inbox waiting',
      run: actions.onNeedsYou,
    },
  ];
  if (actions.onAllSessions) {
    commands.push({
      id: 'all-sessions',
      label: 'All sessions',
      keywords: 'every agent other agents',
      run: actions.onAllSessions,
    });
  }
  if (actions.onAllChats) {
    commands.push({ id: 'all-chats', label: 'All chats', keywords: 'older archived', run: actions.onAllChats });
  }
  for (const item of actions.settings ?? []) {
    commands.push({
      id: `settings:${item.label}`,
      label: `Settings: ${item.label}`,
      keywords: 'preferences',
      run: item.onSelect,
    });
  }
  if (actions.onToggleSidebar) {
    commands.push({
      id: 'toggle-sidebar',
      label: actions.sidebarCollapsed ? 'Show sidebar' : 'Collapse sidebar',
      keywords: 'toggle sidebar rail hide show collapse',
      shortcut: key('B'),
      run: actions.onToggleSidebar,
    });
  }
  if (actions.onWhatsNew) {
    commands.push({
      id: 'whats-new',
      label: 'What’s new',
      keywords: "what's new release notes help",
      run: actions.onWhatsNew,
    });
  }
  if (actions.onCommands) {
    commands.push({
      id: 'commands',
      label: 'Commands and keys',
      keywords: 'help slash shortcuts keyboard',
      run: actions.onCommands,
    });
  }
  return commands;
}
