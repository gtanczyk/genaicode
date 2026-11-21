/** Display helpers shared by the chat front ends (`genaicode/react`, the terminal UI). No React here. */
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { AgentBudget, RateLimit } from '../agents/types.js';
import type { TokenUsage } from '../core/types.js';
import type { PackTask } from '../agents/pack.js';
import type { PackTaskChecks } from '../agents/pack-checks.js';

export function packCheckLabel(checks: PackTaskChecks, kind: 'review' | 'verify'): string {
  const result = checks[kind];
  if (!result) return 'Not run';
  if (result.revision !== checks.revision) return 'Outdated';
  if (result.status === 'running') return 'Running…';
  if (result.status === 'failed') return 'Failed';
  return kind === 'review' ? 'Reviewed' : 'Passed';
}

export function packTaskStatus(task: PackTask, waiting: boolean): string {
  if (waiting) return 'Needs approval';
  if (task.state === 'merged') return 'Merged locally';
  if (task.state === 'discarded') return 'Discarded';
  if (task.status === 'completed' && task.state === 'unmerged') return 'Ready to merge';
  return { running: 'Running', completed: 'Completed', aborted: 'Stopped', failed: 'Failed', timeout: 'Timed out' }[
    task.status
  ];
}

export function packMetrics(turn: SessionTurn): string {
  const pack = turn.pack!;
  const running = pack.tasks.filter((task) => task.status === 'running').length;
  const limits = limitChips({ budget: pack.budget, usage: turn.usage ?? {}, costUsd: turn.costUsd });
  const usage = limits.length
    ? limits.map((chip) => chip.text).join(' · ')
    : formatUsage(turn.usage ?? {}, turn.costUsd);
  return [`${running}/${pack.maxParallel} slots`, usage].filter(Boolean).join(' · ');
}

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

/** One line of a change an agent made: added, removed, or left as it was. */
export interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

/** What an edit changed, as lines to show. `more` counts the lines left out of a long one. */
export interface ToolDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  more: number;
}

const DIFF_SHOWN = 400;

/**
 * The change a tool call makes to a file, read from its input: an edit (`old_string` and
 * `new_string`, alone or in `edits`), a written file (`content`), or a patch (`patch`, or input that
 * is one). Undefined for a call that changes no file, or whose input says nothing of how.
 */
export function toolDiff(input: unknown): ToolDiff | undefined {
  const lines: DiffLine[] = [];
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const pick = (record: Record<string, unknown>, keys: string[]) =>
    keys.map((key) => text(record[key])).find((v) => v !== undefined);
  const edit = (record: Record<string, unknown>): boolean => {
    const before = pick(record, ['old_string', 'oldString', 'old_str', 'oldText']);
    const after = pick(record, ['new_string', 'newString', 'new_str', 'newText']);
    if (before === undefined || after === undefined) return false;
    if (lines.length) lines.push({ sign: ' ', text: '⋯' });
    // Not spread into push: a change can be longer than a call takes arguments.
    for (const line of changedLines(before, after)) lines.push(line);
    return true;
  };
  const patch = (value: string): boolean => {
    if (!/^(\*\*\* Begin Patch|@@|diff --git|--- )/m.test(value)) return false;
    // A `--- ` line names a file before a hunk starts, and is a removed `-- ` line inside one.
    let inHunk = false;
    // Lines a counted hunk (`@@ -1,3 +1,4 @@`) still holds: after them the next file's header can come.
    let left: { old: number; new: number } | undefined;
    for (const line of textLines(value)) {
      if (/^\*\*\* (Begin|End) Patch/.test(line)) continue;
      if (line.startsWith('diff --git')) {
        inHunk = false;
        continue;
      }
      if (left && left.old <= 0 && left.new <= 0) {
        inHunk = false;
        left = undefined;
      }
      if (!inHunk && /^(index |\+\+\+ |--- )/.test(line)) continue;
      // A patch in an agent's own format has no file header lines of that kind.
      if (line.startsWith('@@') || line.startsWith('*** ')) {
        inHunk = true;
        const counted = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
        left = counted ? { old: Number(counted[1] ?? 1), new: Number(counted[2] ?? 1) } : undefined;
        lines.push({ sign: ' ', text: line });
        continue;
      }
      if (line.startsWith('+')) {
        lines.push({ sign: '+', text: line.slice(1) });
        if (left) left.new -= 1;
      } else if (line.startsWith('-')) {
        lines.push({ sign: '-', text: line.slice(1) });
        if (left) left.old -= 1;
      } else if (!line.startsWith('\\')) {
        lines.push({ sign: ' ', text: line.startsWith(' ') ? line.slice(1) : line });
        if (left) {
          left.old -= 1;
          left.new -= 1;
        }
      }
    }
    return true;
  };
  if (typeof input === 'string') {
    if (!patch(input)) return undefined;
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const edits = Array.isArray(record.edits) ? record.edits : undefined;
    const patched = pick(record, ['patch', 'diff', 'input']);
    const content = pick(record, ['content', 'contents', 'file_text']);
    if (edits) {
      for (const one of edits) if (one && typeof one === 'object') edit(one as Record<string, unknown>);
    } else if (edit(record)) {
      // One replacement.
    } else if (patched !== undefined && patch(patched)) {
      // A patch in the agent's own format.
    } else if (content !== undefined && pick(record, ['file_path', 'filePath', 'path']) !== undefined) {
      for (const line of textLines(content)) lines.push({ sign: '+', text: line });
    }
  } else return undefined;
  if (!lines.length) return undefined;
  return {
    lines: lines.slice(0, DIFF_SHOWN),
    added: lines.filter((line) => line.sign === '+').length,
    removed: lines.filter((line) => line.sign === '-').length,
    more: Math.max(0, lines.length - DIFF_SHOWN),
  };
}

/** The lines of `text`: none for no text, and the newline that ends the last one starts no other. */
function textLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const DIFF_CONTEXT = 3;

/**
 * `before` turned into `after`: the middle is replaced, with a few of the lines they share at both
 * ends around it, so a small change in a long text is what shows.
 */
function changedLines(before: string, after: string): DiffLine[] {
  const from = textLines(before);
  const to = textLines(after);
  // Only one of them ends its last line: that is a change too, so that line says it.
  if (from.length && to.length && before.endsWith('\n') !== after.endsWith('\n')) {
    const open = before.endsWith('\n') ? to : from;
    open[open.length - 1] += ' (no newline at end)';
  }
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head += 1;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  )
    tail += 1;
  const out: DiffLine[] = [];
  if (head > DIFF_CONTEXT) out.push({ sign: ' ', text: '⋯' });
  for (let i = Math.max(0, head - DIFF_CONTEXT); i < head; i += 1) out.push({ sign: ' ', text: from[i]! });
  for (let i = head; i < from.length - tail; i += 1) out.push({ sign: '-', text: from[i]! });
  for (let i = head; i < to.length - tail; i += 1) out.push({ sign: '+', text: to[i]! });
  const end = Math.min(from.length, from.length - tail + DIFF_CONTEXT);
  for (let i = from.length - tail; i < end; i += 1) out.push({ sign: ' ', text: from[i]! });
  if (tail > DIFF_CONTEXT) out.push({ sign: ' ', text: '⋯' });
  return out;
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
