import type { SessionState, SessionTurn } from '../agents/session.js';
import type { TokenUsage } from '../core/types.js';

const INPUT_KEYS = ['command', 'cmd', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'description'];

/** `path` relative to `cwd` when it is inside it. */
export function relativePath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** The one argument worth showing for a tool call (its command, path, pattern...). */
export function toolSummary(input: unknown, width = 80, cwd?: string): string {
  if (input === undefined || input === null) return '';
  let value: unknown = input;
  if (typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    value = INPUT_KEYS.map((key) => record[key]).find((field) => typeof field === 'string' || Array.isArray(field));
    if (value === undefined) value = '';
  }
  const flat = (Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim();
  const shown = cwd ? flat.split(cwd.endsWith('/') ? cwd : `${cwd}/`).join('') : flat;
  return shown.length > width ? `${shown.slice(0, width - 1)}…` : shown;
}

/** Friendlier names for the tool ids drivers report. */
export function toolLabel(name: string): string {
  const known: Record<string, string> = {
    shell: 'Shell',
    bash: 'Shell',
    Bash: 'Shell',
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    grep: 'Search',
    Grep: 'Search',
    glob: 'Find',
    Glob: 'Find',
    todowrite: 'Plan',
    TodoWrite: 'Plan',
    webfetch: 'Fetch',
    WebFetch: 'Fetch',
  };
  return known[name] ?? name;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatUsage(usage: TokenUsage, costUsd?: number): string {
  const parts: string[] = [];
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (tokens) parts.push(`${formatTokens(tokens)} tokens`);
  if (costUsd !== undefined) parts.push(`$${costUsd.toFixed(costUsd < 1 ? 3 : 2)}`);
  return parts.join(' · ');
}

/** "done in 12s", "failed: …", or "working 4s" for a turn. */
export function turnFooter(turn: SessionTurn, now = Date.now()): string {
  const took = formatDuration((turn.endedAt ?? now) - turn.startedAt);
  if (!turn.result) return `working ${took}`;
  switch (turn.result.status) {
    case 'completed':
      return turn.result.ok ? `done in ${took}` : `finished with errors in ${took}`;
    case 'aborted':
      return `stopped after ${took}`;
    case 'timeout':
      return `timed out after ${took}`;
    default:
      return `failed after ${took}${turn.result.error ? `: ${firstLine(turn.result.error)}` : ''}`;
  }
}

export function shortId(id: string | undefined): string {
  if (!id) return '';
  // Tails differ where prefixes often do not (opencode ids start with a timestamp).
  return id.length > 12 ? `…${id.slice(-8)}` : id;
}

/** Status line: agent, model, session, usage. */
export function statusParts(state: SessionState): string[] {
  const parts = [state.agent];
  if (state.model) parts.push(state.model);
  if (state.sessionId) parts.push(`session ${shortId(state.sessionId)}`);
  const usage = formatUsage(state.usage, state.costUsd);
  if (usage) parts.push(usage);
  return parts;
}

export function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
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
  { name: '/help', help: 'show commands and keys' },
  { name: '/quit', help: 'exit' },
];

export type SlashCommand =
  | { kind: 'agent'; name?: string }
  | { kind: 'model'; model?: string }
  | { kind: 'new' }
  | { kind: 'stop' }
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
