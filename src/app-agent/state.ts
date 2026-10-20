// What the page sees. No Node imports: genaicode/react uses this too.
import type { SessionState, SessionTurn } from '../agents/session.js';

/** `use`: the agent works the app through its tools. `dev`: it also edits the app's own code. */
export type AppAgentMode = 'use' | 'dev';

export type AppActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'rejected';

/** A write waiting for the user, or done. */
export interface AppAction {
  id: string;
  kind: 'tool' | 'commit';
  /** The one line the user reads before deciding. */
  summary: string;
  tool?: { name: string; args: Record<string, unknown> };
  commit?: { message: string; tree: string };
  status: AppActionStatus;
  result?: string;
  createdAt: number;
}

/** A chip the agent offers under a reply; clicking it opens that page of the app. */
export interface AppLink {
  turnId: number;
  label: string;
  path: string;
}

export interface AppAgentState {
  name: string;
  mode: AppAgentMode;
  /** `dev` is offered only when the app configured it. */
  modes: AppAgentMode[];
  agent: string;
  agents: Array<{ name: string; installed: boolean }>;
  session: SessionState | null;
  /**
   * Turns from before the last agent or mode switch, oldest first. They keep their place in
   * the conversation with negative ids, so links still point at them.
   */
  history: SessionTurn[];
  actions: AppAction[];
  links: AppLink[];
  /** The page the app last reported as open. */
  view: string | null;
  /** A bumped id asks the page to open `path` once. */
  navigation: { id: number; path: string } | null;
}

/** What a proposed commit would change, for the approval card. */
export interface TreeChanges {
  files: Array<{ status: string; path: string }>;
  diff: string;
  /** The diff was cut to fit: it cannot be reviewed here, so the commit cannot be approved. */
  truncated?: boolean;
  /** Changed files whose contents the diff cannot show (binary). */
  binary?: string[];
}

/** Separates the briefing and page context from what the user typed. */
export const PROMPT_MARKER = '\n\nUser message:\n';

/** What the user typed, without the briefing or page context in front of it. */
export function userText(prompt: string): string {
  const at = prompt.lastIndexOf(PROMPT_MARKER);
  return at < 0 ? prompt : prompt.slice(at + PROMPT_MARKER.length);
}

/** Notes the app sends the agent (an action's outcome) start with this. */
export const APP_NOTE = '[app] ';
