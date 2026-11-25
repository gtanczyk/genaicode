/**
 * What `<MissionStrip>` and the Live tab of `<WorkPanel>` show, without React: the team's counts by
 * state, the approvals its tasks wait for, what the lead does now and its plan, the running tasks
 * worth watching, and one feed over every task.
 */
import type { PackStep } from '../agents/pack.js';
import type { ProgressStep } from '../agents/progress.js';
import type { SessionState } from '../agents/session.js';
import type { ApprovalRequest } from '../agents/types.js';
import {
  firstLine,
  packSteerReceipt,
  packStepLine,
  packStepRecency,
  packTaskError,
  packTaskOutcome,
  toolArgument,
  type Receipt,
} from './format.js';
import { askSubject, WORK_GROUPS, workStatus, type WorkGroup, type WorkTask, type WorkTone } from './work.js';

/** How many tasks each group has, in the groups' order; empty groups are left out. */
export function missionCounts(tasks: readonly WorkTask[]): Array<{ group: WorkGroup; count: number }> {
  return WORK_GROUPS.map((group) => ({ group, count: tasks.filter((item) => item.group === group).length })).filter(
    (entry) => entry.count,
  );
}

/**
 * Whether the strip shows: a turn that delegated runs, or a task still runs or waits for the
 * person. A chat whose delegated work is all finished has none.
 */
export function missionActive(state: SessionState | null | undefined, tasks: readonly WorkTask[]): boolean {
  if (!tasks.length) return false;
  if (tasks.some((item) => item.group === 'ask' || item.task.status === 'running')) return true;
  const turn = state?.turns.at(-1);
  return !!turn && !turn.result && tasks.some((item) => item.turnId === turn.id);
}

/** An approval a delegated task waits for, with its task. */
export interface TaskAsk {
  item: WorkTask;
  request: ApprovalRequest;
}

/**
 * The approvals delegated tasks wait for, oldest first: this chat's needs-you queue. A task's
 * question is left out unless `questions`: it is answered in the chat, where its options are.
 */
export function taskAsks(tasks: readonly WorkTask[], options: { questions?: boolean } = {}): TaskAsk[] {
  return tasks.flatMap((item) =>
    item.asks
      .filter((request) => options.questions || request.kind !== 'question')
      .map((request) => ({ item, request })),
  );
}

/** "wants to run": what an approval asks for, after the agent's name. */
export function askVerb(request: ApprovalRequest): string {
  return request.kind === 'command'
    ? 'wants to run'
    : request.kind === 'file-change'
      ? 'wants to apply edits'
      : request.kind === 'question'
        ? 'asks a question'
        : 'asks for permission';
}

/** What the lead does now: a verb ("Running", "Waiting for 2 tasks") and what it works on, when it names something. */
export interface LeadNow {
  lead: string;
  verb: string;
  object?: string;
}

/**
 * What the lead of the running turn does right now: the tool call it is in, the approval it waits
 * for, the tasks it waits for, or its reply. Undefined when no turn runs.
 */
export function leadNow(state: SessionState | null | undefined): LeadNow | undefined {
  const turn = state?.turns.at(-1);
  if (!state || !turn || turn.result || state.status !== 'running') return undefined;
  const lead = turn.pack?.lead ?? turn.agent;
  if (state.approvals.some((request) => !request.subtaskId))
    return { lead, verb: 'Waiting for your answer', object: 'in the chat' };
  const running = (turn.pack?.tasks ?? []).filter((task) => !task.dismissed && task.status === 'running').length;
  const waiting = { lead, verb: `Waiting for ${running} ${running === 1 ? 'task' : 'tasks'}` };
  const last = turn.entries.at(-1);
  if (last?.kind === 'tool' && !last.done) {
    // The pack's own wait says nothing the count of running tasks does not say better.
    if (running && /(^|_)wait$/.test(last.name)) return waiting;
    const line = packStepLine({ kind: 'tool', name: last.name, text: firstLine(toolArgument(last.input, state.cwd)), at: 0 }, 0);
    return { lead, verb: line.verb, object: line.object };
  }
  if (last?.kind === 'text' && last.streaming) return { lead, verb: 'Writing its reply' };
  if (running) return waiting;
  return { lead, verb: 'Working' };
}

/** "claude: waiting for 2 tasks": `leadNow()` on one line. */
export function leadNowText(now: LeadNow): string {
  return `${now.lead}: ${now.verb.charAt(0).toLowerCase()}${now.verb.slice(1)}${now.object ? ` ${now.object}` : ''}`;
}

/** The lead's plan: the latest one it reported in the last turn (`report_progress`). */
export function leadPlan(state: SessionState | null | undefined): { lead: string; steps: ProgressStep[] } | undefined {
  const turn = state?.turns.at(-1);
  const report = turn?.entries.findLast((entry) => entry.kind === 'progress' && entry.plan !== undefined);
  if (!turn || report?.kind !== 'progress' || !report.plan?.length) return undefined;
  return { lead: turn.pack?.lead ?? turn.agent, steps: report.plan };
}

/** Cards in Watching. */
export const WATCHED = 3;

/**
 * The running tasks to watch, `WATCHED` at most: the pinned ones first, then the ones the person
 * messaged (the latest message first), then the newest. A task that waits for an approval is under
 * Needs you instead.
 */
export function watchedTasks(tasks: readonly WorkTask[], pinned: readonly string[] = []): WorkTask[] {
  const running = tasks.filter((item) => item.group === 'running');
  const messaged = (item: WorkTask) => item.task.steers?.findLast((steer) => steer.from === 'user')?.at ?? 0;
  const rank = (item: WorkTask) => {
    const pin = pinned.indexOf(item.key);
    return pin >= 0 ? pin - pinned.length : 0;
  };
  const order = new Map(running.map((item, index) => [item.key, index]));
  return running
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        messaged(b) - messaged(a) ||
        (b.task.startedAt ?? 0) - (a.task.startedAt ?? 0) ||
        order.get(b.key)! - order.get(a.key)!,
    )
    .slice(0, WATCHED);
}

/** One line of the team feed. */
export interface FeedItem {
  /** Stable while the feed grows. */
  id: string;
  /** When it happened (epoch milliseconds); `Number.MAX_SAFE_INTEGER` for what waits right now. */
  at: number;
  tone: WorkTone;
  /** The task it is about (`WorkTask.key`) and its id as shown ("t3"). */
  task: string;
  taskId: string;
  /** `you`, `lead`: a message sent to the task; else the task's agent. */
  from: 'task' | 'you' | 'lead';
  agent: string;
  /** What happened, in words: "said:", "failed", "asks to approve", "6 reads, 2 edits in". */
  text: string;
  /** The command, path or folder the words are about. */
  code?: string;
  /** What follows it: "failed · 12s". */
  tail?: string;
  /** A message's receipt (`from` is `you` or `lead`). */
  receipt?: Receipt;
  /** Routine work: reads, edits, commands that went well. */
  quiet: boolean;
}

const ROUTINE: Array<[RegExp, string, string]> = [
  [/^Read$/, 'read', 'reads'],
  [/^(Edited|Wrote)$/, 'edit', 'edits'],
  [/^Ran$/, 'command', 'commands'],
  [/^Searched$/, 'search', 'searches'],
];

/** The folder every path is in, relative to `cwd`; empty when they share none (or name no path). */
function sharedFolder(paths: string[]): string {
  const folders = paths
    .filter((path) => /^[\w.@~/-]+$/.test(path) && path.includes('/'))
    .map((path) => path.split('/').slice(0, -1));
  if (!folders.length) return '';
  let shared = folders[0]!;
  for (const folder of folders) {
    let same = 0;
    while (same < shared.length && same < folder.length && shared[same] === folder[same]) same++;
    shared = shared.slice(0, same);
  }
  return shared.join('/');
}

/** "6 reads, 2 edits": routine steps counted by what they were. */
function routineSummary(steps: PackStep[], cwd: string): { text: string; code?: string } {
  const counts = new Map<string, number>();
  const paths: string[] = [];
  for (const step of steps) {
    const line = packStepLine(step, 0, cwd);
    const kind = ROUTINE.find(([pattern]) => pattern.test(line.verb));
    const name = kind ? kind[1] : 'other step';
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (kind && (kind[1] === 'read' || kind[1] === 'edit')) paths.push(...line.object.split(/,\s*/));
  }
  const words = [...counts].map(([name, count]) => {
    const plural = ROUTINE.find(([, one]) => one === name)?.[2] ?? 'other steps';
    return `${count} ${count === 1 ? name : plural}`;
  });
  const folder = sharedFolder(paths);
  return { text: words.join(', ') + (folder ? ' in' : ''), ...(folder ? { code: folder } : {}) };
}

/** Lines the feed keeps: the newest ones. */
export const FEED_KEPT = 60;

/**
 * One list over every task, newest first. Highlights are what a task said, the approvals it asked
 * for, its failures, its end, and the person's own messages with their receipts; a task's routine
 * steps (reads, edits, commands that went well) are one line, at the time of the latest. With
 * `everything` each routine step has its own line, and so have a task's start and the lead's messages.
 */
export function teamFeed(tasks: readonly WorkTask[], options: { everything?: boolean } = {}): FeedItem[] {
  const feed: Array<FeedItem & { order: number }> = [];
  let order = 0;
  for (const item of tasks) {
    const { task } = item;
    const add = (entry: Omit<FeedItem, 'task' | 'taskId' | 'agent' | 'from' | 'quiet'> & Partial<FeedItem>) =>
      feed.push({ task: item.key, taskId: task.id, agent: task.agent, from: 'task', quiet: false, order: order++, ...entry });
    if (options.everything && task.startedAt !== undefined)
      add({ id: `${item.key} start`, at: task.startedAt, tone: 'idle', text: `started by ${item.lead}`, quiet: true });
    const routine: PackStep[] = [];
    (task.steps ?? []).forEach((step, index) => {
      const id = `${item.key} step ${step.at} ${index}`;
      const at = packStepRecency(step);
      const line = packStepLine(step, at, task.cwd);
      if (step.kind === 'message') add({ id, at, tone: 'run', text: `said: “${line.object}”` });
      else if (step.kind === 'approval') add({ id, at, tone: 'ask', text: 'asked to approve', code: line.object });
      else if (step.kind === 'error') add({ id, at, tone: 'err', text: line.object });
      // The call a task is in right now is on its card and its row, not in what happened.
      else if (step.kind === 'tool' && step.endedAt === undefined) return;
      else if (line.failed || step.interrupted)
        add({ id, at, tone: 'err', text: line.verb.toLowerCase(), code: line.object, tail: line.detail });
      else if (options.everything)
        add({ id, at, tone: 'idle', text: line.verb.toLowerCase(), code: line.object, tail: line.detail, quiet: true });
      else routine.push(step);
    });
    if (routine.length) {
      add({
        id: `${item.key} routine`,
        at: Math.max(...routine.map(packStepRecency)),
        tone: 'idle',
        ...routineSummary(routine, task.cwd),
        quiet: true,
      });
    }
    (task.steers ?? []).forEach((steer, index) => {
      if (steer.from === 'lead' && !options.everything) return;
      const receipt = packSteerReceipt(steer, task.agent, task.endedAt !== undefined);
      add({
        id: `${item.key} steer ${index}`,
        at: steer.settledAt ?? steer.at,
        tone: receipt.state === 'failed' ? 'err' : receipt.state === 'sending' ? 'run' : 'ok',
        from: steer.from === 'lead' ? 'lead' : 'you',
        text: '',
        receipt,
        quiet: steer.from === 'lead',
      });
    });
    if (task.status !== 'running' && task.endedAt !== undefined) {
      const status = workStatus(item);
      const failed = task.status === 'failed' || task.status === 'timeout';
      const outcome = failed ? (packTaskError(task) ?? '') : packTaskOutcome(task);
      const word = failed ? (task.status === 'timeout' ? 'timed out' : 'failed') : task.status === 'aborted' ? 'stopped' : 'finished';
      add({
        id: `${item.key} end`,
        at: task.endedAt,
        tone: failed ? 'err' : status.tone,
        text: `${word}${outcome ? `: ${outcome}` : ''}`,
      });
    }
    // What a task waits for right now, when its steps do not say so (a state built elsewhere).
    for (const request of item.asks) {
      const subject = askSubject(request);
      const steps = task.steps ?? [];
      if (steps.at(-1)?.kind === 'approval' || steps.some((step) => step.kind === 'approval' && step.text === subject))
        continue;
      add({
        id: `${item.key} ask ${request.id}`,
        at: Number.MAX_SAFE_INTEGER,
        tone: 'ask',
        text: askVerb(request),
        ...(request.kind === 'question' ? {} : { code: subject }),
      });
    }
  }
  return feed
    .sort((a, b) => b.at - a.at || b.order - a.order)
    .slice(0, FEED_KEPT)
    .map(({ order: _order, ...entry }) => entry);
}

/** "12s", "4m", "2h": how long ago, in one unit; "now" for what waits right now. */
export function agoText(at: number, now = Date.now()): string {
  if (at === Number.MAX_SAFE_INTEGER) return 'now';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
