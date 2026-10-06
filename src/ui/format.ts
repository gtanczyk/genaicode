import type { SessionState } from '../agents/session.js';
import { formatUsage, shortId } from '../react/format.js';

export {
  firstLine,
  formatDuration,
  formatTokens,
  formatUsage,
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
  { name: '/agent', args: '[name]', help: 'list agents, or switch (starts a new agent session)' },
  { name: '/model', args: '[id]', help: 'set the model id, or clear it' },
  { name: '/new', help: 'start a fresh agent session (keeps the transcript)' },
  { name: '/stop', help: 'stop the running turn and drop queued prompts' },
  { name: '/bark', args: '[on|off]', help: 'toggle the wolf: a bark when the agent needs you or finishes' },
  { name: '/help', help: 'show commands and keys' },
  { name: '/quit', help: 'exit' },
];

export type SlashCommand =
  | { kind: 'agent'; name?: string }
  | { kind: 'model'; model?: string }
  | { kind: 'new' }
  | { kind: 'stop' }
  | { kind: 'bark'; on?: boolean; invalid?: string }
  | { kind: 'help' }
  | { kind: 'quit' }
  | { kind: 'unknown'; name: string };

/** Parse "/agent codex" style input. Returns undefined for a normal prompt. */
export function parseSlash(text: string): SlashCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;
  const [name, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ') || undefined;
  switch (name) {
    case '/agent':
    case '/agents':
      return { kind: 'agent', name: arg };
    case '/model':
      return { kind: 'model', model: arg };
    case '/new':
    case '/reset':
      return { kind: 'new' };
    case '/stop':
      return { kind: 'stop' };
    case '/bark':
      if (arg === undefined) return { kind: 'bark' };
      if (arg === 'on' || arg === 'off') return { kind: 'bark', on: arg === 'on' };
      return { kind: 'bark', invalid: arg };
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
 * request, or a turn finished. The front ends bark (or ring the terminal bell) on it.
 */
export function needsAttention(before: SessionState | undefined, after: SessionState): 'approval' | 'done' | undefined {
  if (!before) return undefined;
  const seen = new Set(before.approvals.map((request) => request.id));
  if (after.approvals.some((request) => !seen.has(request.id))) return 'approval';
  // Compare finished turns rather than status: a quick turn can start and end between two views.
  const finished = new Set(before.turns.filter((turn) => turn.result).map((turn) => turn.id));
  if (after.turns.some((turn) => turn.result && !finished.has(turn.id))) return 'done';
  return undefined;
}
