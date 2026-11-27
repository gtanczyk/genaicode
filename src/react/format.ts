/** Display helpers shared by the chat front ends (`genaicode/react`, the terminal UI). No React here. */
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { AgentBudget, InputDelivery, RateLimit } from '../agents/types.js';
import type { TokenUsage } from '../core/types.js';
import type { PackSteer, PackStep, PackStopCause, PackTask } from '../agents/pack.js';
import type { PackTaskChecks } from '../agents/pack-checks.js';

const MEMORY_CITATION = '<oai-mem-citation>';
const CITATION_ENTRIES = '<citation_entries>';
const END_MEMORY_CITATION = '</oai-mem-citation>';

/** Hide the structured trailer Codex appends to a reply, including while it is arriving in chunks. */
export function visibleReply(agent: string, text: string, streaming = false): string {
  if (agent !== 'codex' && agent !== 'codexLive') return text;
  let start = text.lastIndexOf(MEMORY_CITATION);
  if (start === -1) {
    if (!streaming) return text;
    start = text.lastIndexOf('<');
    if (start === -1 || !MEMORY_CITATION.startsWith(text.slice(start))) return text;
  } else {
    const body = text.slice(start + MEMORY_CITATION.length).trimStart();
    if (!body.startsWith(CITATION_ENTRIES) && !(streaming && CITATION_ENTRIES.startsWith(body))) return text;
    const end = body.indexOf(END_MEMORY_CITATION);
    if (end < 0 ? !streaming : body.slice(end + END_MEMORY_CITATION.length).trim() !== '') return text;
  }

  const reply = text.slice(0, start);
  // A literal example in a still-open Markdown fence can look exactly like a trailer during streaming.
  let openFence = '';
  for (const match of reply.matchAll(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)/gm)) {
    if (!openFence) openFence = match[1];
    else if (match[1].startsWith(openFence) && !match[2].trim()) openFence = '';
  }
  return openFence ? text : reply.trimEnd();
}

/**
 * Plain words for what became of input sent while an agent worked ("Seen by claude"). Input
 * recorded before delivery was tracked reads "Sent while working".
 */
export function inputDeliveryText(delivery: InputDelivery | undefined, agent: string): string {
  const who = agent || 'the agent';
  switch (delivery) {
    case 'sending':
      return 'Sending…';
    case 'delivered':
      return `Seen by ${who}`;
    case 'sent':
      return `Sent to ${who}`;
    case 'queued':
      return 'Queued for the next turn';
    case 'dropped':
      return 'Not delivered: stopped first';
    default:
      return 'Sent while working';
  }
}

/** What Enter does with the message: starts a turn, goes into the running one, or waits for its end. */
export type SubmitAction = 'send' | 'steer' | 'queue';

/**
 * The submit action for a session: what `send()` does now (`SessionState.sendAction`), so a prompt
 * that waits for a pack review is Queue too. A state without it: an agent that takes input
 * mid-turn is steered, another gets the prompt queued.
 */
export function submitAction(state: Pick<SessionState, 'status' | 'canSteer' | 'sendAction'>): SubmitAction {
  if (state.sendAction) return state.sendAction === 'start' ? 'send' : state.sendAction;
  if (state.status !== 'running') return 'send';
  return state.canSteer ? 'steer' : 'queue';
}

/** What the submit button says on hover: a prompt queued with no turn running waits for a pack review. */
export function submitTitle(state: Pick<SessionState, 'status' | 'canSteer' | 'sendAction'>): string {
  const action = submitAction(state);
  if (action === 'queue' && state.status !== 'running')
    return 'Enter queues this: a review of delegated work holds the budget, so it runs when the review ends';
  return SUBMIT[action].title;
}

/** The submit button's label and what it says on hover, for each action. */
export const SUBMIT: Record<SubmitAction, { label: string; title: string }> = {
  send: { label: 'Send', title: 'Enter sends' },
  steer: {
    label: 'Steer',
    title: 'Enter sends this into the running turn: the agent reads it between two tool calls',
  },
  queue: {
    label: 'Queue',
    title: 'Enter queues this: the agent cannot take input mid-turn, so it runs when the turn ends',
  },
};

/** Where a message sent to a working agent stands, as its receipt shows it. */
export type ReceiptState = 'sending' | 'delivered' | 'answered' | 'sent' | 'queued' | 'failed' | 'unknown';

/** A receipt: the words on it ("✓ Delivered · 0.9s"), what they mean, and the same for a screen reader. */
export interface Receipt {
  state: ReceiptState;
  text: string;
  /** One sentence on what the state means, for a tooltip. */
  title: string;
  /** `text` without its marks, to be read aloud. */
  spoken: string;
}

/** "0.9s" under ten seconds, else as `formatDuration`. */
function tookText(ms: number): string {
  return ms < 9_950 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : formatDuration(ms);
}

/**
 * The receipt of a message sent to an agent while it worked: the lead (`SessionEntry` input) or a
 * delegated task (`PackSteer`). `answered`: the agent said something after it took the message.
 * `scope` is what ran and `ended` whether it is known to have ended: they word why a message was
 * not delivered.
 */
export function messageReceipt(
  message: { delivery?: InputDelivery; at?: number; settledAt?: number },
  agent: string,
  options: { answered?: boolean; scope?: 'turn' | 'task'; ended?: boolean } = {},
): Receipt {
  const who = agent || 'the agent';
  const took =
    message.at !== undefined && message.settledAt !== undefined ? tookText(message.settledAt - message.at) : '';
  const after = took ? ` · ${took}` : '';
  switch (message.delivery) {
    case 'sending':
      return { state: 'sending', text: 'Sending…', spoken: 'Sending', title: `Waiting for ${who} to take it.` };
    case 'delivered':
      return options.answered
        ? {
            state: 'answered',
            text: '✓✓ Delivered · answered',
            spoken: 'Delivered, answered',
            title: `${who} took the message${took ? ` after ${took}` : ''} and has answered since.`,
          }
        : {
            state: 'delivered',
            text: `✓ Delivered${after}`,
            spoken: `Delivered${took ? ` after ${took}` : ''}`,
            title: `${who} took the message${took ? ` after ${took}` : ''}, between two steps of its work.`,
          };
    case 'sent':
      return {
        state: 'sent',
        text: `Sent to ${who}${after}`,
        spoken: `Sent to ${who}`,
        title: `Handed to ${who}, which does not confirm that it read it.`,
      };
    case 'queued':
      return {
        state: 'queued',
        text: 'Queued for the next turn',
        spoken: 'Queued for the next turn',
        title: `The turn ended before ${who} took it, so it runs as the next turn.`,
      };
    case 'dropped':
      return {
        state: 'failed',
        text: 'Not delivered',
        spoken: 'Not delivered',
        title:
          options.scope === 'task'
            ? options.ended
              ? `The task ended before ${who} took it.`
              : `${who} did not confirm that it took the message, so it may not have read it.`
            : `The turn was stopped before ${who} took it.`,
      };
    default:
      return {
        state: 'unknown',
        text: 'Sent while working',
        spoken: 'Sent while working',
        title: 'Sent before delivery was tracked.',
      };
  }
}

/** The receipt of a message steered into a delegated task; `ended`: the task is known to have ended. */
export function packSteerReceipt(steer: PackSteer, agent: string, ended?: boolean): Receipt {
  return messageReceipt(steer, agent, {
    answered: steer.answeredAt !== undefined,
    scope: 'task',
    ended: ended ?? false,
  });
}

/** Who sent input to a delegated task and what became of it: "Your message: Seen by codex". */
export function packSteerText(steer: PackSteer, agent: string): string {
  const who = steer.from === 'lead' ? 'Lead’s message' : 'Your message';
  const delivery =
    steer.delivery === 'dropped' ? 'Not delivered: the task ended first' : inputDeliveryText(steer.delivery, agent);
  return `${who}: ${delivery}`;
}

export function packQuotaText(agent: string, hint: NonNullable<PackTask['quotaHint']>): string {
  const time = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const reset = hint.resetsAt === undefined ? 'Reset time unknown.' : `Reset reported for ${time(hint.resetsAt)}.`;
  const alternative = hint.alternative
    ? `Suggested alternative: ${hint.alternative}.`
    : 'No verified alternative for this task.';
  return `${agent} reported an exhausted ${hint.window} limit at ${time(hint.observedAt)}. ${reset} ${alternative}`;
}

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

/**
 * A short name for a delegated task: the title the lead gave it, else the first sentence of its
 * prompt without a leading "Task:" label, at most 80 characters.
 */
export function packTaskTitle(task: Pick<PackTask, 'title' | 'prompt'>): string {
  if (task.title?.trim()) return task.title.trim();
  const text = task.prompt
    .replace(/^\s*(task|zadanie)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  const sentence = first.charAt(0).toUpperCase() + first.slice(1);
  return sentence.length > 80 ? `${sentence.slice(0, 79).trimEnd()}…` : sentence;
}

/**
 * The card's summary line: how many tasks were delegated, how many still run, and the pack's token
 * budget when one is set. No usage or dollar figure: the turn's cost is the lead's, priced at API
 * rates, and says nothing about what the delegated tasks cost on a subscription.
 */
export function packMetrics(turn: SessionTurn): string {
  const pack = turn.pack!;
  const visible = pack.tasks.filter((task) => !task.dismissed);
  const count = visible.length;
  const running = visible.filter((task) => task.status === 'running').length;
  const budget = budgetStatus(pack.budget, turn.usage ?? {}, turn.costUsd)
    .filter((row) => row.kind === 'tokens')
    .map((row) => `budget ${formatTokens(row.used)}/${formatTokens(row.limit)} tokens`);
  return [`${count} ${count === 1 ? 'task' : 'tasks'} delegated`, running ? `${running} running` : '', ...budget]
    .filter(Boolean)
    .join(' · ');
}

/** "3 delegated tasks": the name of a turn's delegated work on its line in the chat. */
export function packWorkCount(count: number): string {
  return `${count} delegated ${count === 1 ? 'task' : 'tasks'}`;
}

/** Where a turn's delegated tasks stand, for its line in the chat: "1 needs you · 2 running · 3 finished". */
export function packWorkLine(tasks: readonly PackTask[], pending: readonly { subtaskId?: string }[] = []): string {
  const visible = tasks.filter((task) => !task.dismissed);
  const asking = visible.filter((task) => pending.some((request) => request.subtaskId === task.id)).length;
  const running = visible.filter((task) => task.status === 'running').length;
  const failed = visible.filter((task) => task.status === 'failed' || task.status === 'timeout').length;
  const finished = visible.length - running - failed;
  return [
    asking ? `${asking} ${asking === 1 ? 'needs' : 'need'} you` : '',
    running ? `${running} running` : '',
    failed ? `${failed} failed` : '',
    finished ? `${finished} finished` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One line of Markdown as plain text: no heading, quote or list marker, no emphasis or code ticks. */
function plainLine(line: string, max = 160): string {
  const text = line
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * What a running task is doing, from its latest activity line: a tool call split into the tool's
 * name and its argument (the command, path, pattern...), else the line as plain text.
 */
export function packActivity(text: string): { tool?: string; argument?: string; text: string } {
  const call = /^tool (\S+)(?:: ([\s\S]+))?$/.exec(text.trim());
  if (call) {
    const tool = toolLabel(call[1]!);
    const argument = call[2]?.replace(/\s+/g, ' ').trim();
    return argument ? { tool, argument, text: `${tool}: ${argument}` } : { tool, text: `Running ${tool}` };
  }
  const first = text.split('\n').find((line) => line.trim()) ?? '';
  const plain = plainLine(first);
  return { text: plain.charAt(0).toUpperCase() + plain.slice(1) };
}

/** What a tool does, in words: while it runs and once it returned, by the tool's name. */
const TOOL_VERBS: Array<[RegExp, string, string]> = [
  [/todo|plan/, 'Planning', 'Planned'],
  [/^task$|agent|delegate/, 'Delegating', 'Delegated'],
  [/bash|shell|exec|command|terminal/, 'Running', 'Ran'],
  [/grep|search/, 'Searching', 'Searched'],
  [/fetch|web|http|browse/, 'Fetching', 'Fetched'],
  [/edit|patch|replace/, 'Editing', 'Edited'],
  [/write|create/, 'Writing', 'Wrote'],
  [/read|view|cat$/, 'Reading', 'Read'],
  [/glob|find|list|^ls$/, 'Listing', 'Listed'],
];

/** One step of a task as the activity stream words it: a verb, what it works on, and a detail. */
export interface PackStepLine {
  /** "Running", "Ran", "Edited", "Asked to run"... */
  verb: string;
  /** The command, path or pattern; a tool without one is named instead. */
  object: string;
  /** "14s so far" for a running tool call, how long a finished one took ("<1s" under a second), "failed", "interrupted". */
  detail: string;
  /** A tool call that still runs. */
  running: boolean;
  failed: boolean;
}

/** `text` with paths inside `cwd` made relative to it. */
function withoutCwd(text: string, cwd?: string): string {
  return cwd ? text.split(cwd.endsWith('/') ? cwd : `${cwd}/`).join('') : text;
}

/**
 * A step of a delegated task in words (`Running npm test -- cart · 14s so far`, `Edited src/a.ts`).
 * Paths inside `cwd` (the task's directory) are shown relative to it.
 */
export function packStepLine(step: PackStep, now = Date.now(), cwd?: string): PackStepLine {
  const text = withoutCwd(step.text ?? '', cwd);
  const line = (verb: string, object: string, detail = ''): PackStepLine => ({
    verb,
    object,
    detail,
    running: false,
    failed: !!step.failed,
  });
  switch (step.kind) {
    case 'message':
      return line('Said', text);
    case 'edit':
      return line(step.failed ? 'Could not edit' : 'Edited', text, step.failed ? 'failed' : '');
    case 'approval':
      return line('Asked to approve', text);
    case 'error':
      return { ...line('Error', text), failed: true };
    case 'tool': {
      const name = step.name ?? 'tool';
      const running = step.endedAt === undefined;
      const known = TOOL_VERBS.find(([pattern]) => pattern.test(name.toLowerCase()));
      // A call the task's end cut short is worded as under way ("Writing"), never as done ("Wrote").
      const ongoing = running || !!step.interrupted;
      const verb = known ? known[ongoing ? 1 : 2] : ongoing ? 'Using' : 'Used';
      // A tool that names nothing it works on is named itself; an unknown one is named with it.
      const object = known ? text || toolLabel(name) : text ? `${toolLabel(name)} ${text}` : toolLabel(name);
      const span = (step.endedAt ?? now) - step.at;
      const took = running ? `${formatDuration(span)} so far` : span >= 1000 ? formatDuration(span) : '<1s';
      return {
        verb,
        object,
        detail: [step.failed ? 'failed' : '', step.interrupted ? 'interrupted' : '', took].filter(Boolean).join(' · '),
        running,
        failed: !!step.failed,
      };
    }
  }
}

/** When a step last moved: a tool call that returned (or was cut short) when it ended, else when it happened. */
export function packStepRecency(step: PackStep): number {
  return step.kind === 'tool' && step.endedAt !== undefined ? step.endedAt : step.at;
}

/** The tool call a running task is in right now: its latest one that has not returned. */
export function packRunningStep(task: PackTask): PackStep | undefined {
  if (task.status !== 'running') return undefined;
  return task.steps?.findLast((step) => step.kind === 'tool' && step.endedAt === undefined);
}

/** The latest thing a task said, on one line. */
export function packLatestMessage(task: PackTask): string | undefined {
  return task.steps?.findLast((step) => step.kind === 'message')?.text;
}

/** A time of day as the activity stream shows it ("10:02"). */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const STOPPED_BY: Record<PackStopCause, string> = {
  user: 'Stopped by you',
  lead: 'Stopped by the lead agent',
  'lead-finished': 'Stopped when the lead agent finished',
  turn: 'Stopped with the turn',
  budget: 'Stopped: over budget',
};

/** The runtime's own message for a stopped task ("codex was stopped."), which says nothing the status does not. */
function isStopNotice(task: PackTask, line: string): boolean {
  return task.status === 'aborted' && line.trim() === `${task.agent} was stopped.`;
}

/** A diagnostic on one line, shortened but otherwise verbatim (no Markdown is stripped from it). */
function diagnosticLine(line: string, max = 160): string {
  const text = line.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Why a stopped task stopped ("Stopped by you"), or undefined for a task that was not stopped.
 * Without a recorded cause it is plain "Stopped".
 */
export function packTaskStopped(task: PackTask): string | undefined {
  if (task.status !== 'aborted') return undefined;
  return task.stoppedBy ? STOPPED_BY[task.stoppedBy] : 'Stopped';
}

/** A task's error worth showing: none for the runtime's "<agent> was stopped." a stopped task carries. */
export function packTaskError(task: PackTask): string | undefined {
  return task.error && !isStopNotice(task, task.error) ? task.error : undefined;
}

/**
 * A task's outcome on one line: its latest activity while it runs; once it ended, the changed-file
 * count of a worktree task, then why it was stopped, its error (verbatim, only shortened), the
 * verdict pack read from its whole final message ("VERDICT: LGTM"), or the first line of that
 * message. The runtime's "<agent> was stopped." of a stopped task says nothing the status does
 * not, so it is left out.
 */
export function packTaskOutcome(task: PackTask): string {
  if (task.status === 'running') return task.text ? packActivity(task.text).text : '';
  const parts: string[] = [];
  if (task.mode === 'worktree' && task.changes) {
    const count = task.changes.length;
    parts.push(count ? `${count} ${count === 1 ? 'file' : 'files'} changed` : 'No file changes');
  }
  const said = (text?: string) => (text ?? '').split('\n').filter((line) => line.trim() && !isStopNotice(task, line));
  const stop = task.status === 'aborted' && task.stoppedBy ? STOPPED_BY[task.stoppedBy] : undefined;
  const error = said(task.error)[0];
  const line =
    stop ?? (error ? diagnosticLine(error) : undefined) ?? plainLine(task.verdict ?? said(task.text)[0] ?? '');
  if (line) parts.push(line);
  return parts.join(' · ');
}

/** How long a task ran, or has been running at `now`; empty when the task carries no start time. */
export function packTaskElapsed(task: PackTask, now = Date.now()): string {
  if (task.startedAt === undefined) return '';
  const end = task.endedAt ?? (task.status === 'running' ? now : undefined);
  return end === undefined ? '' : formatDuration(end - task.startedAt);
}

/** A task that still wants attention: it runs, waits for an approval, or has changes to merge. */
export function packTaskActive(task: PackTask, waiting = false): boolean {
  return waiting || task.status === 'running' || (task.status === 'completed' && task.state === 'unmerged');
}

/** Finished tasks a compact task list shows before folding the older ones away. */
export const PACK_FINISHED_SHOWN = 3;

/**
 * Delegated tasks in the order a compact list shows them: tasks asking for approval or running,
 * then tasks with changes to merge, then finished tasks. Running tasks come newest delegated
 * first, ended ones latest ended first (reports without `endedAt` before them, in delegation order). Unless
 * `expanded`, finished tasks past the newest `PACK_FINISHED_SHOWN` fold away (`hidden` counts
 * them), except `keep` (the selected task). Folding one task alone saves nothing, so it never does.
 */
export function packTaskList(
  tasks: readonly PackTask[],
  options: { asking?: (task: PackTask) => boolean; keep?: string; expanded?: boolean } = {},
): { shown: PackTask[]; hidden: number } {
  const asking = options.asking ?? (() => false);
  const newest = tasks
    .filter((task) => !task.dismissed)
    .slice()
    .reverse();
  // Ended tasks: the one that ended last first. A report without an end time goes before them, in
  // delegation order (the sort is stable).
  const end = (task: PackTask) => task.endedAt ?? Infinity;
  const latestEnd = (a: PackTask, b: PackTask) => (end(a) === end(b) ? 0 : end(a) < end(b) ? 1 : -1);
  const urgent = newest.filter((task) => task.status === 'running' || asking(task));
  const ready = newest.filter((task) => !urgent.includes(task) && packTaskActive(task)).sort(latestEnd);
  const finished = newest.filter((task) => !urgent.includes(task) && !ready.includes(task)).sort(latestEnd);
  const fold = !options.expanded && finished.length > PACK_FINISHED_SHOWN + 1;
  const kept = fold
    ? finished.filter((task, index) => index < PACK_FINISHED_SHOWN || task.id === options.keep)
    : finished;
  return { shown: [...urgent, ...ready, ...kept], hidden: finished.length - kept.length };
}

/** Above this many tasks the inline card shows one-line rows, a filter, and its first rows only. */
export const PACK_DENSE_ABOVE = 15;
/** Rows the inline card shows of a long list before **Show N more**, and how many that adds. */
export const PACK_DENSE_SHOWN = 12;
export const PACK_DENSE_PAGE = 50;

/**
 * A finished task that leaves nothing to do in the card: it is not running or asking and has no
 * worktree to merge or discard. Such a task can be cleared from the list.
 */
export function packTaskClearable(task: PackTask, waiting = false): boolean {
  return !waiting && task.status !== 'running' && task.state !== 'unmerged';
}

/**
 * A long list of delegated tasks for the inline card: in `packTaskList` order, without the
 * `cleared` ones, narrowed to the tasks whose title, agent, id or status has every word of `query`,
 * and cut to the first `PACK_DENSE_SHOWN + more` rows (`keep`, the selected task, always shows
 * unless it is cleared). `hidden` counts the rows cut, `earlier` says they are all finished ones,
 * `matched` counts the tasks that pass the filter and `clearable` the finished ones among them
 * that can be cleared, the selected one included: the host picks another once it is cleared.
 */
export function packDenseList(
  tasks: readonly PackTask[],
  options: {
    asking?: (task: PackTask) => boolean;
    keep?: string;
    query?: string;
    more?: number;
    cleared?: readonly string[];
  } = {},
): { shown: PackTask[]; hidden: number; earlier: boolean; matched: number; clearable: PackTask[]; cleared: number } {
  const asking = options.asking ?? (() => false);
  const words = (options.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const gone = new Set(options.cleared ?? []);
  const isCleared = (task: PackTask) => gone.has(task.id) && packTaskClearable(task, asking(task));
  const listed = packTaskList(tasks, { asking, expanded: true }).shown.filter((task) => !isCleared(task));
  const matching = listed.filter((task) => {
    if (!words.length) return true;
    const text =
      `${packTaskTitle(task)}\n${task.agent}\n${task.id}\n${packTaskStatus(task, asking(task))}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const limit = PACK_DENSE_SHOWN + Math.max(0, options.more ?? 0);
  const count = matching.length - limit <= 1 ? matching.length : limit;
  const shown = matching.filter((task, index) => index < count || task.id === options.keep);
  const rest = matching.filter((task) => !shown.includes(task));
  return {
    shown,
    hidden: rest.length,
    earlier: rest.length > 0 && rest.every((task) => !packTaskActive(task, asking(task))),
    matched: matching.length,
    clearable: matching.filter((task) => packTaskClearable(task, asking(task))),
    cleared: tasks.filter(isCleared).length,
  };
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

/** The file a tool call reads or changes, as its input names it; undefined when it names none. */
export function toolPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  // A command or a search can carry a `path` too: that one is where it runs, not a file to show.
  if (['command', 'cmd', 'pattern', 'query'].some((key) => key in record)) return undefined;
  const path = ['file_path', 'filePath', 'path'].map((key) => record[key]).find((field) => typeof field === 'string');
  return typeof path === 'string' && path.trim() ? path : undefined;
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
