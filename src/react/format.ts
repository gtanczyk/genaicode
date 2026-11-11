/** Display helpers shared by the chat front ends (`genaicode/react`, the terminal UI). No React here. */
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { AgentBudget, RateLimit } from '../agents/types.js';
import type { TokenUsage } from '../core/types.js';

const INPUT_KEYS = ['command', 'cmd', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'description'];

/** `path` relative to `cwd` when it is inside it. */
export function relativePath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** The one argument worth showing for a tool call (its command, path, pattern...), whole and with its line breaks. */
export function toolArgument(input: unknown, cwd?: string): string {
  if (input === undefined || input === null) return '';
  let value: unknown = input;
  if (typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    value = INPUT_KEYS.map((key) => record[key]).find((field) => typeof field === 'string' || Array.isArray(field));
    if (value === undefined) value = '';
  }
  const text = (Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '').trim();
  return cwd ? text.split(cwd.endsWith('/') ? cwd : `${cwd}/`).join('') : text;
}

/** {@link toolArgument} on one line, cut to `width`. */
export function toolSummary(input: unknown, width = 80, cwd?: string): string {
  const shown = toolArgument(input, cwd).replace(/\s+/g, ' ');
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

export type LimitLevel = 'ok' | 'warning' | 'exceeded';

/** One limit for a status bar: `text` to show, `level` to color it, `title` for a tooltip. */
export interface LimitChip {
  key: string;
  text: string;
  level: LimitLevel;
  title: string;
}

/** "in 2h 5m", "in 3d 4h", "now" until `at`. */
export function formatResetIn(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `in ${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
}

export interface BudgetRow {
  kind: 'tokens' | 'cost';
  used: number;
  limit: number;
  level: LimitLevel;
}

/** How much of each cap of a session `budget` is used. */
export function budgetStatus(
  budget: AgentBudget | undefined,
  usage: TokenUsage,
  costUsd: number | undefined,
): BudgetRow[] {
  if (!budget) return [];
  const warnAt = budget.warnAt ?? 0.8;
  const level = (used: number, limit: number): LimitLevel =>
    used >= limit ? 'exceeded' : used >= limit * warnAt ? 'warning' : 'ok';
  const rows: BudgetRow[] = [];
  if (budget.maxTokens !== undefined) {
    const used = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    rows.push({ kind: 'tokens', used, limit: budget.maxTokens, level: level(used, budget.maxTokens) });
  }
  if (budget.maxCostUsd !== undefined) {
    const used = costUsd ?? 0;
    rows.push({ kind: 'cost', used, limit: budget.maxCostUsd, level: level(used, budget.maxCostUsd) });
  }
  return rows;
}

const LEVEL_ORDER: Record<LimitLevel, number> = { exceeded: 0, warning: 1, ok: 2 };

/**
 * Plan limits and the session budget as chips, worst first: "5h 82% · resets in 1h 5m",
 * "budget 45k/100k tokens". A limit at `ok` with no percentage says nothing and is left out.
 */
export function limitChips(
  state: Pick<SessionState, 'usage' | 'costUsd' | 'budget' | 'rateLimits'>,
  now = Date.now(),
): LimitChip[] {
  const chips: LimitChip[] = [];
  for (const row of budgetStatus(state.budget, state.usage, state.costUsd)) {
    const text =
      row.kind === 'tokens'
        ? `budget ${formatTokens(row.used)}/${formatTokens(row.limit)} tokens`
        : `budget $${row.used.toFixed(2)}/$${row.limit.toFixed(2)}`;
    const title =
      row.level === 'exceeded'
        ? 'Session budget used up: new prompts will not start.'
        : `Session ${row.kind === 'tokens' ? 'token' : 'cost'} budget.`;
    chips.push({ key: `budget-${row.kind}`, text, level: row.level, title });
  }
  for (const limit of state.rateLimits ?? []) {
    if (limit.status === 'ok' && limit.usedPercent === undefined) continue;
    // A reset in the past: the window has rolled over since the report.
    if (limit.resetsAt !== undefined && limit.resetsAt <= now) continue;
    chips.push(rateLimitChip(limit, now));
  }
  return chips.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

function rateLimitChip(limit: RateLimit, now: number): LimitChip {
  const name = limit.name ? `${limit.name} ` : '';
  const used =
    limit.usedPercent !== undefined
      ? ` ${Math.round(limit.usedPercent)}%`
      : limit.status === 'exceeded'
        ? ' reached'
        : '';
  const resetsIn = limit.resetsAt !== undefined ? formatResetIn(limit.resetsAt, now) : undefined;
  const title =
    limit.status === 'exceeded'
      ? `The agent's ${limit.window} limit is used up${resetsIn ? `; it resets ${resetsIn}` : ''}.`
      : `The agent's ${limit.window} plan limit${limit.status === 'warning' ? ', close to running out' : ''}.`;
  return {
    key: `limit-${limit.name ?? ''}-${limit.window}`,
    text: `${name}${limit.window}${used}${resetsIn ? ` · resets ${resetsIn}` : ''}`,
    level: limit.status,
    title,
  };
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

export function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
