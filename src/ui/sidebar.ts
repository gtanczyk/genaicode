import { attentionOf, type SessionInfo } from '../agents/sessions/group.js';
import type { RateLimit } from '../agents/types.js';

/**
 * The state of a chat or session as its glyph says it (docs/design/desktop-layout.md, "Visual
 * language"): one hue and one shape per state, the same everywhere in the window.
 */
export type ChatGlyph = 'run' | 'ask' | 'err' | 'ok' | 'idle';

export const GLYPH_TITLE: Record<ChatGlyph, string> = {
  run: 'Running',
  ask: 'Needs you',
  err: 'Failed',
  ok: 'Done',
  idle: 'Idle',
};

/** What a listed session's glyph shows: an agent at work, one that asks for you, one that ended, or one left. */
export function sessionGlyph(session: SessionInfo, now = Date.now()): ChatGlyph {
  if (session.waitingFor === 'approval' || attentionOf(session, now) === 'now') return 'ask';
  if (session.state === 'active') return 'run';
  if (session.state === 'waiting') return 'ok';
  return 'idle';
}

/** What the open chat's glyph shows, from its live state: that beats what the stores last wrote. */
export function liveGlyph(chat: {
  status: string;
  approvals: number;
  failed?: boolean;
  turns: number;
}): ChatGlyph | undefined {
  if (chat.approvals) return 'ask';
  if (chat.status === 'running') return 'run';
  if (!chat.turns) return undefined;
  return chat.failed ? 'err' : 'ok';
}

const trimDir = (dir: string) => (dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir);

/** The last path segment of a directory. */
export function folderName(dir: string): string {
  return trimDir(dir).split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

/** `source:id`: what tells two agents' sessions apart. */
export const sessionKey = (session: Pick<SessionInfo, 'source' | 'id'>) => `${session.source}:${session.id}`;

/** The key of the group for chats started without a folder. */
export const HOME_FOLDER = '';

/** A project of the sidebar: one directory and this app's chats in it, newest first. */
export interface ChatProject {
  /** The directory, or `HOME_FOLDER`. */
  key: string;
  /** The folder's name, or "Home folder". */
  name: string;
  /** The full path, for the tooltip. Absent for the home folder when its path is not known. */
  path?: string;
  chats: SessionInfo[];
  updatedAt: number;
}

/**
 * This app's chats by directory, the one meaning of "project" in the window: the project worked in
 * last comes first, and the chats without a folder (none, or the app's own `home` directory) sit
 * under "Home folder".
 */
export function chatProjects(chats: readonly SessionInfo[], options: { home?: string } = {}): ChatProject[] {
  const home = options.home ? trimDir(options.home) : undefined;
  const projects = new Map<string, ChatProject>();
  for (const chat of chats) {
    if (chat.archived) continue;
    const dir = chat.cwd ? trimDir(chat.cwd) : undefined;
    const atHome = !dir || dir === home;
    const key = atHome ? HOME_FOLDER : dir;
    let project = projects.get(key);
    if (!project) {
      project = atHome
        ? { key, name: 'Home folder', ...(home ? { path: home } : {}), chats: [], updatedAt: 0 }
        : { key, name: folderName(dir), path: dir, chats: [], updatedAt: 0 };
      projects.set(key, project);
    }
    project.chats.push(chat);
    project.updatedAt = Math.max(project.updatedAt, chat.updatedAt);
  }
  for (const project of projects.values()) project.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The open chat as a row of the list, for when the stores do not list it (yet): a chat is in the
 * sidebar from its first prompt, and a page without `/api/sessions` still shows the one it has.
 */
export function withOpenChat(
  chats: readonly SessionInfo[],
  open: { id?: string; agent: string; cwd: string; title?: string; updatedAt: number } | undefined,
): SessionInfo[] {
  if (!open) return [...chats];
  const listed = open.id ? chats.find((chat) => chat.id === open.id) : undefined;
  if (listed) {
    // Its title here is the one the top bar shows; the row keeps moving to the top while it is worked in.
    return chats.map((chat) =>
      chat === listed
        ? { ...chat, ...(open.title ? { title: open.title } : {}), updatedAt: Math.max(chat.updatedAt, open.updatedAt) }
        : chat,
    );
  }
  return [
    {
      source: OPEN_CHAT_SOURCE,
      agent: open.agent,
      id: open.id ?? '',
      where: 'local',
      cwd: open.cwd,
      ...(open.title ? { title: open.title } : {}),
      updatedAt: open.updatedAt,
    },
    ...chats,
  ];
}

/** The `source` of the open chat's row while no store lists it. */
export const OPEN_CHAT_SOURCE = 'genaicode:open';

/** What a row says: the title, else what was asked first or last, else the id. */
export function chatTitle(session: SessionInfo): string {
  const text = session.title || session.firstPrompt || session.lastPrompt || session.id || 'New chat';
  return text.split('\n', 1)[0]!.trim() || 'New chat';
}

/**
 * The sessions this app did not start, for "Other agents' sessions": those that ask for you first,
 * then the latest, at most `limit` of them, and how many there are in all.
 */
export function otherSessions(
  all: readonly SessionInfo[],
  own: readonly SessionInfo[],
  limit = 4,
  now = Date.now(),
): { shown: SessionInfo[]; total: number } {
  const mine = new Set(own.map(sessionKey));
  const ids = new Set(own.map((session) => session.id));
  const others = all.filter((session) => !session.archived && !mine.has(sessionKey(session)) && !ids.has(session.id));
  const asks = (session: SessionInfo) => (sessionGlyph(session, now) === 'ask' ? 0 : 1);
  const shown = [...others].sort((a, b) => asks(a) - asks(b) || b.updatedAt - a.updatedAt).slice(0, limit);
  return { shown, total: others.length };
}

/** How much needs the person: across every project, and in the open chat. */
export interface NeedsYou {
  total: number;
  here: number;
  title: string;
}

/**
 * The count on "Needs you": the open chat's approvals and questions, the tower's drafts, and the
 * sessions of every agent that ask now (the open chat's own session is counted once, as live).
 */
export function needsYou(input: {
  approvals: number;
  tower?: number;
  sessions?: readonly SessionInfo[];
  openId?: string;
  now?: number;
}): NeedsYou {
  const elsewhere = (input.sessions ?? []).filter(
    (session) => session.id !== input.openId && attentionOf(session, input.now) === 'now',
  ).length;
  const total = input.approvals + (input.tower ?? 0) + elsewhere;
  const scope = `${total} across all projects${input.approvals ? `, ${input.approvals} in this chat` : ''}`;
  return { total, here: input.approvals, title: total ? `Needs you: ${scope}` : 'Nothing needs you now' };
}

/** One agent's plan in the sidebar: its worst window. */
export interface QuotaRow {
  agent: string;
  /** 0-100, absent when the agent reported no limits. */
  percent?: number;
  level: 'ok' | 'warning' | 'exceeded';
  /** `62% · 5h`, `out · 6h`, `no limits`. */
  text: string;
  title: string;
}

function resetIn(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((at - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/**
 * One row per agent with the worst window of its plan, the agents closest to their limit first.
 * `agents` are the ones to name even when they reported nothing ("no limits"). `codexLive` and
 * `codex` draw on one account, so they share a row.
 */
export function quotaRows(
  limits: ReadonlyArray<RateLimit & { agent: string }>,
  agents: readonly string[] = [],
  now = Date.now(),
): QuotaRow[] {
  const account = (agent: string) => agent.replace(/Live$/, '');
  const names = [...new Set([...agents.map(account), ...limits.map((limit) => account(limit.agent))])];
  const weight = (limit: RateLimit) => (limit.status === 'exceeded' ? 1000 : 0) + (limit.usedPercent ?? 0);
  const rows = names.map((agent): QuotaRow => {
    const known = limits.filter(
      (limit) =>
        account(limit.agent) === agent &&
        // A reset in the past: the window has rolled over since the report.
        !(limit.resetsAt !== undefined && limit.resetsAt <= now) &&
        !(limit.status === 'ok' && limit.usedPercent === undefined),
    );
    const worst = [...known].sort((a, b) => weight(b) - weight(a))[0];
    if (!worst) {
      return { agent, level: 'ok', text: 'no limits', title: `${agent} reported no plan limits.` };
    }
    const out = worst.status === 'exceeded';
    const percent = out ? 100 : Math.min(100, Math.round(worst.usedPercent ?? 0));
    const reset = worst.resetsAt !== undefined ? resetIn(worst.resetsAt, now) : undefined;
    const name = worst.name ? `${worst.name} ` : '';
    return {
      agent,
      percent,
      level: worst.status,
      text: out ? `out${reset ? ` · ${reset}` : ''}` : `${percent}% · ${worst.window}`,
      title: out
        ? `${agent}: the ${name}${worst.window} limit is used up${reset ? `, resets in ${reset}` : ''}.`
        : `${agent}: ${percent}% of the ${name}${worst.window} limit${reset ? `, resets in ${reset}` : ''}.`,
    };
  });
  return rows.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.agent.localeCompare(b.agent));
}

/** What the window has open, innermost first, for Escape. */
export interface OpenThings {
  /** A menu or popover of the shell (Help, Settings, the session menu, artifacts). */
  menu?: boolean;
  /** The file or artifact viewer beside the chat. */
  viewer?: boolean;
  /** A page in the chat's place (All sessions, Needs you, Agents). */
  page?: boolean;
  /** Keyboard focus is in the message field. */
  inComposer?: boolean;
  /** A turn runs, or a `!command` does. */
  running?: boolean;
}

/**
 * What Escape does: it closes the innermost open thing, and stops a running turn only when nothing
 * is open and the focus is in the message field. Otherwise nothing.
 */
export function escapeAction(open: OpenThings): 'menu' | 'viewer' | 'page' | 'stop' | undefined {
  if (open.menu) return 'menu';
  if (open.viewer) return 'viewer';
  if (open.page) return 'page';
  if (open.inComposer && open.running) return 'stop';
  return undefined;
}

/** Below this window width the sidebar is the icon rail unless the person chose otherwise. */
export const RAIL_BELOW_PX = 980;

/** Whether the sidebar starts as the rail: what was chosen in this window, else by its width. */
export function startsCollapsed(stored: string | null | undefined, width: number): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return width < RAIL_BELOW_PX;
}
