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
  open: { id?: string; source?: string; agent: string; cwd: string; title?: string; updatedAt: number } | undefined,
): SessionInfo[] {
  if (!open) return [...chats];
  const listed = open.id ? chats.find((chat) => isOpenChat(chat, open)) : undefined;
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

/**
 * Whether `chat` is the row of the open chat: the row `withOpenChat` added, or the session with its
 * id in its agent's store (`open.source`), as another store may hold a session with the same id.
 * With no store known the id alone decides.
 */
export function isOpenChat(chat: Pick<SessionInfo, 'source' | 'id'>, open: { id?: string; source?: string }): boolean {
  if (chat.source === OPEN_CHAT_SOURCE) return true;
  return !!open.id && chat.id === open.id && (!open.source || chat.source === open.source);
}

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
  // A session is this app's by its store and id, or by its agent and id (the same session read
  // through another of its agent's stores, or the open chat's row no store lists yet): an id alone
  // says nothing, as two agents' stores may both hold it.
  const mine = new Set(own.map(sessionKey));
  const agentKey = (session: Pick<SessionInfo, 'agent' | 'id'>) => `${session.agent}\n${session.id}`;
  const byAgent = new Set(own.filter((session) => session.id).map(agentKey));
  const others = all.filter(
    (session) => !session.archived && !mine.has(sessionKey(session)) && !byAgent.has(agentKey(session)),
  );
  const asks = (session: SessionInfo) => (sessionGlyph(session, now) === 'ask' ? 0 : 1);
  const shown = [...others].sort((a, b) => asks(a) - asks(b) || b.updatedAt - a.updatedAt).slice(0, limit);
  return { shown, total: others.length };
}

/** How much needs the person: across every project, and in the open chat. */
export interface NeedsYou {
  total: number;
  here: number;
  /** The sessions that ask now and are in no other count: what the filtered sessions list adds. */
  sessions: number;
  title: string;
}

/** A tower item as the count reads it (`TowerItem`). */
export interface NeedsYouItem {
  id: string;
  /** The session it stands for, in the store `source` or, from a hook, of the agent `agent`. */
  sessionId?: string;
  source?: string;
  agent?: string;
}

/** The tower lists the open chat's own approvals under ids that start so. */
const TOWER_TURN_ITEM = 'turn:';

/**
 * Whether a tower item stands for this session. Two stores may hold the same id, so the id alone
 * does not say: the item names the store, or (a hook's question) the agent of a local session.
 */
function itemIsFor(item: NeedsYouItem, session: SessionInfo): boolean {
  if (!item.sessionId || item.sessionId !== session.id) return false;
  if (item.source !== undefined) return item.source === session.source;
  if (item.agent !== undefined) return session.where === 'local' && item.agent === session.agent;
  return true;
}

/**
 * The count on "Needs you": the open chat's approvals and questions, the tower's items, and the
 * sessions of every agent that ask now. Each request is counted once: the tower repeats the open
 * chat's approvals, and its items for another agent's session stand for that session, so neither is
 * added again (nor is the open chat's own session: it counts as live). A session is the same one
 * only in the same store: an id that two stores share is two sessions.
 */
export function needsYou(input: {
  approvals: number;
  tower?: readonly NeedsYouItem[];
  sessions?: readonly SessionInfo[];
  /** The open chat's session: its id and the store of its agent (unknown: the id alone decides). */
  open?: { id?: string; source?: string };
  now?: number;
}): NeedsYou {
  const tower = (input.tower ?? []).filter((item) => !item.id.startsWith(TOWER_TURN_ITEM));
  const open = input.open;
  const isOpen = (session: SessionInfo) =>
    !!open?.id && session.id === open.id && (open.source === undefined || session.source === open.source);
  const elsewhere = (input.sessions ?? []).filter(
    (session) =>
      !isOpen(session) && !tower.some((item) => itemIsFor(item, session)) && attentionOf(session, input.now) === 'now',
  ).length;
  const total = input.approvals + tower.length + elsewhere;
  const scope = `${total} across all projects${input.approvals ? `, ${input.approvals} in this chat` : ''}`;
  return {
    total,
    here: input.approvals,
    sessions: elsewhere,
    title: total ? `Needs you: ${scope}` : 'Nothing needs you now',
  };
}

/**
 * Where "Needs you" goes. With a tower it is always the tower's inbox, also when that is empty: the
 * result of the last delivery and the stores that could not be read are only there (the sessions
 * that ask are one step on from it). Without one, the sessions that ask now; else the chat.
 */
export function needsYouPage(has: { tower: boolean; sessions: boolean }): 'inbox' | 'sessions' | 'chat' {
  if (has.tower) return 'inbox';
  return has.sessions ? 'sessions' : 'chat';
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

/**
 * What the window has open under its menus, popovers and viewer, for Escape. Those are not here:
 * each claims the key while it is open (`claimEscape`), the one opened last first, and the key
 * gets this far only when none of them is.
 */
export interface OpenThings {
  /** A page in the chat's place (All sessions, Needs you, Agents). */
  page?: boolean;
  /** Keyboard focus is in the message field. */
  inComposer?: boolean;
  /** A turn runs, or a `!command` does. */
  running?: boolean;
}

/**
 * What Escape does once no menu, popover or viewer took it: it leaves the open page, and stops a
 * running turn only when no page is open and the focus is in the message field. Otherwise nothing.
 */
export function escapeAction(open: OpenThings): 'page' | 'stop' | undefined {
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
