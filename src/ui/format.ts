import type { SessionState } from '../agents/session.js';
import { formatUsage, shortId } from '../react/format.js';

export {
  firstLine,
  formatDuration,
  formatTokens,
  formatUsage,
  limitChips,
  relativePath,
  shortId,
  toolLabel,
  toolSummary,
  turnFooter,
} from '../react/format.js';

/** Status line: agent, model, session, usage. */
export function statusParts(state: SessionState): string[] {
  const parts = [state.agent];
  if (state.model) parts.push(state.model);
  if (state.effort) parts.push(`effort ${state.effort}`);
  if (state.mode === 'plan') parts.push('plan');
  if (state.fallback?.length) parts.push(`fallback ${state.fallback.join(',')}`);
  if (state.sessionId) parts.push(`session ${shortId(state.sessionId)}`);
  const usage = formatUsage(state.usage, state.costUsd);
  if (usage) parts.push(usage);
  return parts;
}

/** Last `count` non-empty lines of tool output, and how many were left out. */
export function outputTail(output: string | undefined, count: number): { lines: string[]; hidden: number } {
  const lines = (output ?? '').replace(/\s+$/, '').split('\n');
  if (lines.length === 1 && !lines[0]) return { lines: [], hidden: 0 };
  return { lines: lines.slice(-count), hidden: Math.max(0, lines.length - count) };
}

/** Slash commands shared by the terminal and web front ends. */
export const SLASH_COMMANDS: ReadonlyArray<{ name: string; args?: string; help: string }> = [
  {
    name: '/agent',
    args: '[name] [--fresh]',
    help: 'list agents, or switch (hands the conversation over; --fresh starts with no context)',
  },
  { name: '/fallback', args: '[agents|off]', help: 'agents to switch to when this one runs out (e.g. codex,gemini)' },
  { name: '/model', args: '[id]', help: 'set the model id, or clear it' },
  { name: '/effort', args: '[level|default]', help: "set the reasoning effort, in the agent's own words, or clear it" },
  { name: '/plan', args: '[on|off]', help: 'toggle Plan mode for the next prompts (explore and ask without editing)' },
  { name: '/waiting', args: '[project]', help: 'refresh the waiting queue (tower or --sessions)' },
  { name: '/read', args: '<session id>', help: 'preview recent turns locally (tower or --sessions)' },
  {
    name: '/continue',
    args: '<session id>',
    help: 'take over a session of any agent in this directory (ids: genaicode sessions)',
  },
  { name: '/new', help: 'start a fresh agent session (keeps the transcript)' },
  { name: '/clear', help: 'start a new conversation: a fresh agent session and an empty transcript' },
  { name: '/where', help: 'show the working directory of this conversation' },
  { name: '/stop', help: 'stop the running turn, drop queued prompts, end !commands' },
  { name: '/web', args: '[off]', help: 'open this session in the browser (same agent, same transcript)' },
  { name: '/auto', args: '[on|off]', help: 'approve every permission request the agent asks for, or ask again' },
  { name: '/bark', args: '[on|off]', help: 'toggle the wolf: a bark when the agent needs you or finishes' },
  { name: '/help', help: 'show commands and keys' },
  { name: '/quit', help: 'exit' },
];

export type SlashCommand =
  | { kind: 'agent'; name?: string; fresh?: boolean }
  | { kind: 'model'; model?: string }
  /** No `effort`: say what it is and what the agent takes. */
  | { kind: 'effort'; effort?: string }
  /** No `names` and no `off`: show the list. */
  | { kind: 'fallback'; names?: string[]; off?: boolean }
  | { kind: 'new' }
  | { kind: 'clear' }
  | { kind: 'where' }
  | { kind: 'continue'; id?: string }
  | { kind: 'waiting'; project?: string }
  | { kind: 'read'; id?: string }
  | { kind: 'stop' }
  | { kind: 'bark'; on?: boolean; invalid?: string }
  | { kind: 'auto'; on?: boolean; invalid?: string }
  | { kind: 'plan'; on?: boolean; invalid?: string }
  | { kind: 'web'; off: boolean; invalid?: string }
  | { kind: 'help' }
  | { kind: 'quit' }
  | { kind: 'unknown'; name: string };

/** `text` as the agent gets it when the files at `paths` were sent with it: they are named at its end. */
export function withAttached(text: string, paths: readonly string[]): string {
  if (!paths.length) return text;
  const said = text.trim();
  return `${said ? `${said}\n\n` : ''}${ATTACHED_MARK}\n${paths.map((path) => `- ${path}`).join('\n')}`;
}

/** The reverse of `withAttached`: what the user typed, and the files that went with it. */
export function splitAttached(text: string): {
  text: string;
  files: Array<{ path: string; name: string; id?: string }>;
} {
  const at = text.startsWith(`${ATTACHED_MARK}\n`) ? 0 : text.lastIndexOf(`\n\n${ATTACHED_MARK}\n`);
  if (at === -1) return { text, files: [] };
  const lines = text.slice(at).trim().split('\n').slice(1);
  if (!lines.length || !lines.every((line) => line.startsWith('- ') && line.length > 2)) return { text, files: [] };
  return {
    text: text.slice(0, at),
    files: lines.map((line) => {
      const path = line.slice(2);
      const file = path.split(/[\\/]/).pop() ?? path;
      const kept = /^([0-9a-f]{16})-(.+)$/.exec(file);
      return kept ? { path, name: kept[2]!, id: kept[1]! } : { path, name: file };
    }),
  };
}

const ATTACHED_MARK = 'Attached files (read them from disk):';

/** The command of a `!npm test` line, '' for a bare `!`; undefined otherwise (`!!` sends a `!`). */
export function parseShell(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('!') || trimmed.startsWith('!!')) return undefined;
  return trimmed.slice(1).trim();
}

/** Parse "/agent codex" style input. Returns undefined for a normal prompt. */
export function parseSlash(text: string): SlashCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;
  const [name, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ') || undefined;
  switch (name) {
    case '/agent':
    case '/agents': {
      const fresh = rest.includes('--fresh');
      const name = rest.filter((word) => word !== '--fresh').join(' ') || undefined;
      return fresh ? { kind: 'agent', name, fresh } : { kind: 'agent', name };
    }
    case '/model':
      return { kind: 'model', model: arg };
    case '/effort':
      return { kind: 'effort', effort: arg?.toLowerCase() };
    case '/fallback':
    case '/failover':
      if (arg === undefined) return { kind: 'fallback' };
      if (arg === 'off' || arg === 'none') return { kind: 'fallback', off: true };
      return { kind: 'fallback', names: arg.split(/[\s,]+/).filter(Boolean) };
    case '/continue':
    case '/from':
      return { kind: 'continue', id: arg };
    case '/waiting':
      return { kind: 'waiting', project: arg };
    case '/read':
      return { kind: 'read', id: arg };
    case '/new':
    case '/reset':
      return { kind: 'new' };
    case '/clear':
      return { kind: 'clear' };
    case '/where':
      return { kind: 'where' };
    case '/stop':
      return { kind: 'stop' };
    case '/bark':
      if (arg === undefined) return { kind: 'bark' };
      if (arg === 'on' || arg === 'off') return { kind: 'bark', on: arg === 'on' };
      return { kind: 'bark', invalid: arg };
    case '/auto':
    case '/yolo':
      if (arg === undefined) return { kind: 'auto' };
      if (arg === 'on' || arg === 'off') return { kind: 'auto', on: arg === 'on' };
      return { kind: 'auto', invalid: arg };
    case '/plan':
      if (arg === undefined) return { kind: 'plan' };
      if (arg === 'on' || arg === 'off') return { kind: 'plan', on: arg === 'on' };
      return { kind: 'plan', invalid: arg };
    case '/web':
    case '/ui':
    case '/browser':
      if (arg === undefined || arg === 'off') return { kind: 'web', off: arg === 'off' };
      return { kind: 'web', off: false, invalid: arg };
    case '/help':
    case '/?':
      return { kind: 'help' };
    case '/quit':
    case '/exit':
      return { kind: 'quit' };
    default:
      return { kind: 'unknown', name };
  }
}

/**
 * Whether the change from `before` to `after` needs the person at the keyboard: a new approval
 * request, a turn finished, or a relayed session message settled. The front ends bark (or ring the
 * terminal bell) on it.
 */
export function needsAttention(
  before: SessionState | undefined,
  after: SessionState,
  beforeNotices?: ReadonlyArray<{ id: string | number; relay?: { status: string } }>,
  afterNotices?: ReadonlyArray<{ id: string | number; relay?: { status: string } }>,
): 'approval' | 'done' | undefined {
  if (!before) return undefined;
  const seen = new Set(before.approvals.map((request) => request.id));
  if (after.approvals.some((request) => !seen.has(request.id))) return 'approval';
  // Compare finished turns rather than status: a quick turn can start and end between two views.
  const finished = new Set(before.turns.filter((turn) => turn.result).map((turn) => turn.id));
  if (after.turns.some((turn) => turn.result && !finished.has(turn.id))) return 'done';
  if (beforeNotices && afterNotices) {
    const isSettled = (status: string) => status === 'answered' || status === 'failed';
    const settled = new Set(
      beforeNotices.filter((item) => item.relay && isSettled(item.relay.status)).map((item) => item.id),
    );
    if (afterNotices.some((item) => item.relay && isSettled(item.relay.status) && !settled.has(item.id))) return 'done';
  }
  return undefined;
}
