import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { TokenUsage } from '../core/types.js';
import { findExecutable } from './discovery.js';
import { approximateSize, EventQueue } from './event-queue.js';
import { startLocalMcpServer } from './mcp-server.js';
import type { McpTool } from './mcp-tools.js';
import { addWorktree, applyPatch, removeWorktree, repoRoot, worktreeChanges, worktreeDiff } from './pack-git.js';
import { addUsage, tokenCount } from './usage.js';
import type {
  AgentEvent,
  AgentFailure,
  AgentResult,
  AgentRun,
  AgentTask,
  ApprovalRequest,
  BudgetWarning,
  CodingAgent,
  RateLimit,
} from './types.js';

export interface PackOptions {
  /** The agent that takes the prompt and hands work out. Needs `capabilities.mcp`. */
  lead: CodingAgent;
  /** Agents the lead may delegate to. The lead may be one of them. */
  members: readonly CodingAgent[];
  /** Name of the combined agent. Default `pack`. */
  name?: string;
  /** Most delegated tasks running at once. Default 4. */
  maxParallel?: number;
  /** Let the lead draft a message for the tower operator to review. */
  sessionProposalTool?: McpTool;
  /** Replaces the briefing put in front of the lead's first prompt. */
  brief?(members: readonly PackMember[]): string;
  /** Where worktrees go, relative to the repository root. Default `.genaicode/worktrees`. */
  worktreeDir?: string;
  /**
   * Called with a new worktree before its agent starts, e.g. to link `node_modules`: a worktree
   * holds the repository's files without anything git ignores.
   */
  prepareWorktree?(dir: string, repo: string): void | Promise<void>;
}

/** What the lead learns about a member from the `agents` tool. */
export interface PackMember {
  name: string;
  installed: boolean;
  /** Delegated tasks it is running now. */
  running: number;
  steer: boolean;
  /** The latest plan limits it reported, by window. */
  limits?: RateLimit[];
  /** How its last delegated task failed, when the agent itself was at fault. */
  lastFailure?: AgentFailure;
}

export type PackTaskStatus = 'running' | AgentResult['status'];

/** A delegated task, as the `wait` tool and `tasks()` report it. */
export interface PackTask {
  id: string;
  agent: string;
  prompt: string;
  mode: 'worktree' | 'shared';
  status: PackTaskStatus;
  /** This running task accepts steering input. */
  canSteer?: boolean;
  /** Where the agent works: its worktree, or the lead's directory. */
  cwd: string;
  /** The agent's final message, or the last thing it did while running. */
  text?: string;
  error?: string;
  failure?: AgentFailure;
  /** `git diff --name-status` lines of a worktree task, once it ended. */
  changes?: string[];
  /** What became of a worktree task's changes. */
  state?: 'unmerged' | 'merged' | 'discarded';
}

export interface Pack extends CodingAgent {
  /** Every task delegated so far, over all runs. */
  tasks(): PackTask[];
  /** Stop running tasks and remove the worktrees still on disk (unmerged changes are lost). */
  close(): Promise<void>;
}

export type PackAction = { type: 'steer'; text: string } | { type: 'stop' | 'diff' | 'merge' | 'discard' };

const packActionRefusals = {
  missing: 'This pack task could not be found.',
  'not-running': 'This task is no longer running.',
  'cannot-steer': 'This agent cannot take input while it runs.',
  input: 'A nonempty instruction is required.',
  running: 'This task is still running.',
  shared: 'This task ran in the shared directory and has no worktree.',
  merged: 'This task was already merged.',
  discarded: 'This task was already discarded.',
  unavailable: 'This task no longer has a worktree.',
  conflict: 'These changes do not apply cleanly; nothing was changed.',
};

export type PackActionErrorReason = keyof typeof packActionRefusals;

/** A refused pack action has a public explanation. Git, driver and filesystem exceptions may carry diagnostics. */
export class PackActionError extends Error {
  override name = 'PackActionError';

  constructor(
    readonly reason: PackActionErrorReason,
    detail?: string,
  ) {
    super(detail ?? packActionRefusals[reason]);
  }

  get publicMessage(): string {
    return packActionRefusals[this.reason];
  }
}

/** The same operations as the lead's tools, scoped to the tasks delegated in one run. */
export interface PackControls {
  readonly lead: string;
  readonly maxParallel: number;
  task(id: string): PackTask | undefined;
  act(id: string, action: PackAction): Promise<string>;
}

/** Events and the approval callback use the same identity in the chat's shared queue. */
export function packApproval(id: string, agent: string, request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    id: `${id}:${request.id}`,
    subtaskId: id,
    summary: `[${agent} ${id}] ${request.summary ?? request.kind}`,
  };
}

interface Sub {
  id: string;
  agent: CodingAgent;
  prompt: string;
  mode: 'worktree' | 'shared';
  cwd: string;
  repo?: string;
  dir?: string;
  start?: string;
  status: PackTaskStatus;
  run?: AgentRun;
  result?: AgentResult;
  last?: string;
  usage?: TokenUsage;
  costUsd?: number;
  changes?: string[];
  state?: 'unmerged' | 'merged' | 'discarded';
  /** A `wait` already told the lead how it ended. */
  reported?: boolean;
  ended: Promise<void>;
}

const CLIP = 4_000;
const MAX_DIFF = 60_000;

const clip = (text: string, max = CLIP) =>
  text.length > max ? `${text.slice(0, max)}\n[... ${text.length - max} more characters]` : text;

function defaultBrief(members: readonly PackMember[]): string {
  const names = members.filter((member) => member.installed).map((member) => member.name);
  return [
    'You lead a pack of coding agents on this machine. Besides doing work yourself, you can hand parts of it to the',
    `others through the \`pack\` MCP tools. Agents available: ${names.join(', ') || 'none'}.`,
    '- `agents` lists them with their limits. `delegate` starts a task on one and returns at once, so several can run',
    '  in parallel. Give each a complete, self-contained prompt: it sees none of this conversation.',
    '- By default a delegated task works in its own git worktree, a copy of the current files. Nothing it does',
    '  reaches your directory until you `merge` it (`diff` shows it first, `discard` drops it). Use mode `shared`',
    '  for read-only work such as a review, which then runs in your directory.',
    '- `wait` blocks until tasks finish (or its timeout passes; call it again). Always wait for, and then merge or',
    '  discard, every task before you finish. Tasks still running when you finish are stopped.',
    '- Delegate what gains from it: independent pieces in parallel, a second opinion or review from a different',
    '  agent, or work for an agent that still has quota when another ran out. Small tasks are faster done yourself.',
  ].join('\n');
}

/** `agent.run(task)`, with a driver that throws on start turned into a run that failed. */
function startRun(agent: CodingAgent, task: AgentTask): AgentRun {
  try {
    return agent.run(task);
  } catch (error) {
    const result: AgentResult = {
      status: 'failed',
      ok: false,
      exitCode: null,
      signal: null,
      error: error instanceof Error ? error.message : String(error),
    };
    return {
      result: Promise.resolve(result),
      abort() {},
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', result } satisfies AgentEvent;
      },
    };
  }
}

/** A short line on what a running task is doing, from its latest event. */
function activity(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'message':
      return clip(event.text, 300);
    case 'tool-start':
      return `tool ${event.name}`;
    case 'file-change':
      return `edited ${event.paths.join(', ')}`;
    case 'approval-request':
      return `waiting for approval: ${event.request.summary ?? event.request.kind}`;
    case 'error':
      return `error: ${clip(event.message, 300)}`;
    default:
      return undefined;
  }
}

/**
 * One `CodingAgent` over the agents on a machine: `lead` gets the prompt plus MCP tools to
 * delegate parts of it to `members` (in parallel, each in its own git worktree), follow them, and
 * merge what they did. Routing is the lead's judgement; genaicode adds the tools, not a loop.
 *
 * Events are the lead's, plus `subtask-start`, `subtask` and `subtask-update` for delegated work.
 * `usage` events and the result's usage add up the lead and every delegated task, and
 * `task.budget` caps that sum. Delegated tasks inherit `env`, `permissions` and `onApproval`
 * (request ids are prefixed with the task id). `resume`, `steer()` and the session id are the lead's.
 */
export function pack(options: PackOptions): Pack {
  const { lead, members } = options;
  const maxParallel = options.maxParallel ?? 4;
  const subs = new Map<string, Sub>();
  const limits = new Map<string, Map<string, RateLimit>>();
  const lastFailure = new Map<string, AgentFailure>();
  // Lead and chat share one queue: a discard cannot remove a worktree while a patch is being read or applied.
  let worktreeQueue: Promise<unknown> = Promise.resolve();
  const withWorktree = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = worktreeQueue.then(operation);
    worktreeQueue = next.catch(() => {});
    return next;
  };
  let nextId = 1;
  // Delegations still setting up their worktree: they hold a `maxParallel` slot already.
  let starting = 0;

  const noteLimit = (agent: string, limit: RateLimit) => {
    let known = limits.get(agent);
    if (!known) limits.set(agent, (known = new Map()));
    known.set(limit.window, limit);
  };

  const describeMembers = (env: NodeJS.ProcessEnv | undefined): PackMember[] =>
    members.map((member) => {
      const known = [...(limits.get(member.name)?.values() ?? [])];
      const failure = lastFailure.get(member.name);
      return {
        name: member.name,
        installed: findExecutable(member.command, env) !== null,
        running: [...subs.values()].filter((sub) => sub.agent === member && sub.status === 'running').length,
        steer: !!member.capabilities.steer,
        ...(known.length ? { limits: known } : {}),
        ...(failure ? { lastFailure: failure } : {}),
      };
    });

  const report = (sub: Sub): PackTask => ({
    id: sub.id,
    agent: sub.agent.name,
    prompt: sub.prompt,
    mode: sub.mode,
    status: sub.status,
    ...(sub.run?.steer ? { canSteer: true } : {}),
    cwd: sub.cwd,
    ...(sub.result?.text !== undefined
      ? { text: clip(sub.result.text) }
      : sub.status === 'running' && sub.last
        ? { text: sub.last }
        : {}),
    ...(sub.result?.error ? { error: clip(sub.result.error) } : {}),
    ...(sub.result?.failure ? { failure: sub.result.failure } : {}),
    ...(sub.changes ? { changes: sub.changes } : {}),
    ...(sub.state ? { state: sub.state } : {}),
  });

  const drop = async (sub: Sub) => {
    if (sub.repo && sub.dir) await removeWorktree(sub.repo, sub.dir);
    sub.dir = undefined;
  };

  return {
    name: options.name ?? 'pack',
    command: lead.command,
    capabilities: lead.capabilities,
    // A pack turn is a session of its lead.
    ...(lead.sessions !== undefined ? { sessions: lead.sessions } : {}),
    tasks: () => [...subs.values()].map(report),
    async close() {
      const all = [...subs.values()];
      for (const sub of all) sub.run?.abort();
      await Promise.all(all.map((sub) => sub.ended));
      await withWorktree(async () => {
        for (const sub of all) {
          if (sub.dir && sub.state === 'unmerged') sub.state = 'discarded';
          await drop(sub);
        }
      });
    },
    run(task) {
      const events = new EventQueue<AgentEvent>(approximateSize);
      const ended = new AbortController();
      const mine = new Set<Sub>();
      const settingUp = new Set<Promise<string>>();
      let leadRun: AgentRun | undefined;
      let stopped = false;
      let leadUsage: TokenUsage | undefined;
      let leadCost: number | undefined;
      let overBudget: string | undefined;
      const warned = new Set<BudgetWarning['kind']>();

      const total = (): { usage?: TokenUsage; costUsd?: number } => {
        let usage = leadUsage;
        let costUsd = leadCost;
        for (const sub of mine) {
          if (sub.usage) usage = usage ? addUsage(usage, sub.usage) : sub.usage;
          if (sub.costUsd !== undefined) costUsd = (costUsd ?? 0) + sub.costUsd;
        }
        return { ...(usage ? { usage } : {}), ...(costUsd !== undefined ? { costUsd } : {}) };
      };

      const stopAll = () => {
        leadRun?.abort();
        for (const sub of mine) sub.run?.abort();
      };

      /** Report the pack's usage so far and enforce `task.budget` against it. */
      const usageChanged = () => {
        const { usage, costUsd } = total();
        if (!usage && costUsd === undefined) return;
        events.push({ type: 'usage', usage: usage ?? {}, ...(costUsd !== undefined ? { costUsd } : {}) });
        const budget = task.budget;
        if (!budget || overBudget) return;
        const checks: BudgetWarning[] = [];
        if (budget.maxTokens !== undefined)
          checks.push({ kind: 'tokens', used: usage ? tokenCount(usage) : 0, limit: budget.maxTokens });
        if (budget.maxCostUsd !== undefined && costUsd !== undefined)
          checks.push({ kind: 'cost', used: costUsd, limit: budget.maxCostUsd });
        for (const check of checks) {
          if (check.used > check.limit) {
            overBudget =
              check.kind === 'tokens'
                ? `The pack went over its token budget (${check.used} of ${check.limit}).`
                : `The pack went over its cost budget ($${check.used.toFixed(4)} of $${check.limit}).`;
            events.push({ type: 'error', message: overBudget });
            stopAll();
            return;
          }
          if (check.used >= check.limit * (budget.warnAt ?? 0.8) && !warned.has(check.kind)) {
            warned.add(check.kind);
            events.push({ type: 'budget-warning', warning: check });
          }
        }
      };

      const find = (id: unknown): Sub => {
        const sub = typeof id === 'string' ? subs.get(id) : undefined;
        if (!sub)
          throw new PackActionError(
            'missing',
            `No task ${String(id)}. Known: ${[...subs.keys()].join(', ') || 'none'}.`,
          );
        return sub;
      };

      const delegate = async (args: Record<string, unknown>): Promise<string> => {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        if (!prompt) throw new Error('`prompt` is required.');
        const agent = members.find((member) => member.name === args.agent);
        if (!agent)
          throw new Error(`No agent ${String(args.agent)}. Available: ${members.map((m) => m.name).join(', ')}.`);
        if (findExecutable(agent.command, task.env) === null) throw new Error(`${agent.name} is not installed.`);
        if (ended.signal.aborted) throw new Error('The run has ended.');
        const running = [...subs.values()].filter((sub) => sub.status === 'running').length + starting;
        if (running >= maxParallel)
          throw new Error(`${running} tasks are running already (the most allowed). Wait for one to finish.`);
        // Taken before the first await, so calls made at the same moment cannot share a slot.
        starting += 1;
        const setup = start(agent, prompt, args.mode).finally(() => {
          starting -= 1;
          settingUp.delete(setup);
        });
        settingUp.add(setup);
        return setup;
      };

      const start = async (agent: CodingAgent, prompt: string, wanted: unknown): Promise<string> => {
        const repo = await repoRoot(task.cwd);
        const mode = wanted === 'shared' ? 'shared' : wanted === undefined || wanted === 'worktree' ? 'worktree' : null;
        if (!mode) throw new Error('`mode` is `worktree` or `shared`.');
        if (mode === 'worktree' && !repo)
          throw new Error(
            'The working directory is not a git repository, so there are no worktrees. Use mode `shared`.',
          );

        const id = `t${nextId++}`;
        let settle!: () => void;
        const sub: Sub = {
          id,
          agent,
          prompt,
          mode,
          cwd: task.cwd,
          status: 'running',
          ended: new Promise<void>((resolve) => (settle = resolve)),
        };
        if (mode === 'worktree' && repo) {
          const dir = path.join(
            repo,
            options.worktreeDir ?? path.join('.genaicode', 'worktrees'),
            `${id}-${Date.now().toString(36)}`,
          );
          sub.start = await addWorktree(repo, dir);
          sub.repo = repo;
          sub.dir = dir;
          sub.state = 'unmerged';
          sub.cwd = path.join(dir, path.relative(repo, task.cwd));
          mkdirSync(sub.cwd, { recursive: true });
          try {
            await options.prepareWorktree?.(dir, repo);
            // The lead finished while the worktree was being set up: nobody would follow the task.
            if (ended.signal.aborted) throw new Error('The run has ended.');
          } catch (error) {
            await drop(sub);
            throw error;
          }
        }
        subs.set(id, sub);
        mine.add(sub);
        events.push({ type: 'subtask-start', id, agent: agent.name, prompt, cwd: sub.cwd, mode });

        const onApproval = task.onApproval;
        const run = startRun(agent, {
          prompt,
          cwd: sub.cwd,
          ...(task.env ? { env: task.env } : {}),
          ...(task.permissions !== undefined ? { permissions: task.permissions } : {}),
          ...(onApproval
            ? {
                onApproval: (request, signal) => onApproval(packApproval(id, agent.name, request), signal),
              }
            : {}),
        });
        sub.run = run;
        if (stopped || ended.signal.aborted) run.abort();
        void (async () => {
          let result: AgentResult;
          try {
            for await (const event of run) {
              sub.last = event.type === 'approval-resolved' ? undefined : (activity(event) ?? sub.last);
              if (event.type === 'rate-limit') noteLimit(agent.name, event.limit);
              if (event.type === 'usage') {
                sub.usage = event.usage;
                if (event.costUsd !== undefined) sub.costUsd = event.costUsd;
                usageChanged();
              }
              if (event.type !== 'done' && event.type !== 'raw' && event.type !== 'stderr') {
                events.push({ type: 'subtask', id, agent: agent.name, event });
                await events.room();
              }
            }
            result = await run.result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result = { status: 'failed', ok: false, exitCode: null, signal: null, error: message };
          }
          if (result.usage) sub.usage = result.usage;
          if (result.costUsd !== undefined) sub.costUsd = result.costUsd;
          if (result.failure) lastFailure.set(agent.name, result.failure);
          else if (result.ok) lastFailure.delete(agent.name);
          if (sub.dir && sub.start) {
            try {
              sub.changes = await worktreeChanges(sub.dir, sub.start);
            } catch {
              sub.changes = undefined;
            }
          }
          sub.result = result;
          sub.status = result.status;
          sub.run = undefined;
          events.push({ type: 'subtask', id, agent: agent.name, event: { type: 'done', result } });
          usageChanged();
          settle();
        })();
        return JSON.stringify({ id, agent: agent.name, mode, cwd: sub.cwd });
      };

      const wait = async (args: Record<string, unknown>): Promise<string> => {
        const ids = Array.isArray(args.ids) && args.ids.length ? args.ids : null;
        // By default: what still runs, and what ended since the lead last heard of it.
        const chosen = ids
          ? ids.map(find)
          : [...subs.values()].filter((sub) => sub.status === 'running' || !sub.reported);
        const seconds = typeof args.timeoutSeconds === 'number' ? Math.min(Math.max(args.timeoutSeconds, 0), 600) : 45;
        const pending = chosen.filter((sub) => sub.status === 'running').map((sub) => sub.ended);
        if (pending.length && seconds > 0) {
          let timer: NodeJS.Timeout | undefined;
          const onEnd = new Promise<void>((resolve) =>
            ended.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          await Promise.race([
            args.until === 'any' ? Promise.race(pending) : Promise.all(pending),
            new Promise<void>((resolve) => (timer = setTimeout(resolve, seconds * 1000))),
            onEnd,
          ]);
          clearTimeout(timer);
        }
        for (const sub of chosen) if (sub.status !== 'running') sub.reported = true;
        return JSON.stringify(chosen.map(report), null, 1);
      };

      const worktreeReason = (sub: Sub): PackActionErrorReason =>
        sub.mode !== 'worktree'
          ? 'shared'
          : sub.state === 'merged'
            ? 'merged'
            : sub.state === 'discarded'
              ? 'discarded'
              : 'unavailable';

      const merge = (sub: Sub, threeWay = false): Promise<string> => {
        return withWorktree(async () => {
          if (sub.status === 'running')
            throw new PackActionError('running', `${sub.id} is still running. Wait for it first.`);
          if (sub.mode !== 'worktree')
            throw new PackActionError('shared', `${sub.id} ran in the shared directory: there is nothing to merge.`);
          if (sub.state !== 'unmerged' || !sub.dir || !sub.start || !sub.repo)
            throw new PackActionError(worktreeReason(sub), `${sub.id} is already ${sub.state}.`);
          const patch = await worktreeDiff(sub.dir, sub.start);
          const paths = (sub.changes ?? []).map((line) => line.split('\t').slice(1).join('\t'));
          if (patch.trim()) {
            const applied = await applyPatch(sub.repo, patch, threeWay);
            if (!applied.ok) {
              if (!applied.conflicts)
                throw new PackActionError(
                  'conflict',
                  `The changes of ${sub.id} do not apply cleanly, nothing was changed:\n${clip(applied.error)}\n` +
                    'Call merge again with threeWay: true to merge what fits and get conflict markers in the rest, or apply the diff by hand.',
                );
              sub.state = 'merged';
              await drop(sub);
              events.push({ type: 'subtask-update', id: sub.id, agent: sub.agent.name, state: 'merged', paths });
              events.push({
                type: 'file-change',
                paths: paths.map((file) => path.join(path.relative(task.cwd, sub.repo!), file)),
              });
              return `Merged ${sub.id} with conflicts. Resolve the conflict markers in:\n${clip(applied.error)}`;
            }
          }
          sub.state = 'merged';
          const repo = sub.repo;
          await drop(sub);
          events.push({ type: 'subtask-update', id: sub.id, agent: sub.agent.name, state: 'merged', paths });
          if (paths.length)
            events.push({
              type: 'file-change',
              paths: paths.map((file) => path.join(path.relative(task.cwd, repo), file)),
            });
          return paths.length ? `Merged ${sub.id}:\n${(sub.changes ?? []).join('\n')}` : `${sub.id} changed nothing.`;
        });
      };

      const steer = async (sub: Sub, text: unknown) => {
        if (sub.status !== 'running' || !sub.run) throw new PackActionError('not-running', `${sub.id} is not running.`);
        if (!sub.run.steer)
          throw new PackActionError(
            'cannot-steer',
            `${sub.agent.name} cannot take input while it runs. Stop it and delegate again.`,
          );
        if (typeof text !== 'string' || !text.trim()) throw new PackActionError('input', '`text` is required.');
        await sub.run.steer(text);
        return `Sent to ${sub.id}.`;
      };

      const stop = async (sub: Sub) => {
        if (sub.status !== 'running') return `${sub.id} already ended (${sub.status}).`;
        sub.run?.abort();
        await sub.ended;
        return `Stopped ${sub.id}.`;
      };

      const diff = (sub: Sub) =>
        withWorktree(async () => {
          if (!sub.dir || !sub.start)
            throw new PackActionError(worktreeReason(sub), `${sub.id} has no worktree (${sub.state ?? 'shared'}).`);
          return clip(await worktreeDiff(sub.dir, sub.start), MAX_DIFF) || 'No changes.';
        });

      const discard = (sub: Sub) =>
        withWorktree(async () => {
          if (sub.status === 'running')
            throw new PackActionError('running', `${sub.id} is still running. Stop it first.`);
          if (sub.state !== 'unmerged')
            throw new PackActionError(
              worktreeReason(sub),
              `${sub.id} is ${sub.state ?? 'a shared task'}: nothing to discard.`,
            );
          sub.state = 'discarded';
          await drop(sub);
          events.push({ type: 'subtask-update', id: sub.id, agent: sub.agent.name, state: 'discarded' });
          return `Discarded ${sub.id}.`;
        });

      const tools: McpTool[] = [
        ...(options.sessionProposalTool ? [options.sessionProposalTool] : []),
        {
          name: 'agents',
          description:
            'List the coding agents you can delegate to: whether each is installed, what it is running, and the plan limits it reported.',
          inputSchema: { type: 'object', properties: {} },
          call: async () => JSON.stringify(describeMembers(task.env), null, 1),
        },
        {
          name: 'delegate',
          description:
            'Start a task on another coding agent and return its id at once. The agent sees only `prompt`. Mode `worktree` (default) gives it its own copy of the current files, to merge later; `shared` runs it in your directory (for read-only work such as reviews).',
          inputSchema: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Agent name, from `agents`.' },
              prompt: { type: 'string', description: 'The complete task, with all the context the agent needs.' },
              mode: { type: 'string', enum: ['worktree', 'shared'] },
            },
            required: ['agent', 'prompt'],
          },
          call: delegate,
        },
        {
          name: 'wait',
          description:
            'Wait for delegated tasks and report them: status, final message (or latest activity), error, changed files. Returns when the tasks finished or after timeoutSeconds (default 45); call again while any is `running`.',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Tasks to wait for. Default: every running task, and those that ended since the last wait.',
              },
              until: {
                type: 'string',
                enum: ['all', 'any'],
                description: 'Return when all of them finished (default) or as soon as one did.',
              },
              timeoutSeconds: { type: 'number', description: '0 reports without waiting. At most 600.' },
            },
          },
          call: wait,
        },
        {
          name: 'steer',
          description: 'Send more input to a running task, for agents that take it (`steer` in `agents`).',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, text: { type: 'string' } },
            required: ['id', 'text'],
          },
          call: (args) => steer(find(args.id), args.text),
        },
        {
          name: 'stop',
          description: 'Stop a running task. What it changed so far stays in its worktree.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          call: (args) => stop(find(args.id)),
        },
        {
          name: 'diff',
          description: 'The changes a worktree task made, as a unified diff.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          call: (args) => diff(find(args.id)),
        },
        {
          name: 'merge',
          description:
            "Apply a finished worktree task's changes to your directory and remove its worktree. All or nothing, unless threeWay is true: then what fits is merged and the rest gets conflict markers for you to resolve.",
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, threeWay: { type: 'boolean' } },
            required: ['id'],
          },
          call: (args) => merge(find(args.id), args.threeWay === true),
        },
        {
          name: 'discard',
          description: "Drop a finished worktree task's changes and remove its worktree.",
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          call: (args) => discard(find(args.id)),
        },
      ];

      const failed = (error: string, failure?: AgentFailure): AgentResult => ({
        status: 'failed',
        ok: false,
        exitCode: null,
        signal: null,
        error,
        ...(failure ? { failure } : {}),
      });

      const result = (async (): Promise<AgentResult> => {
        if (!lead.capabilities.mcp) return failed(`${lead.name} cannot attach MCP servers, so it cannot lead a pack.`);
        const server = await startLocalMcpServer({ name: 'pack', tools });
        let own: AgentResult;
        try {
          const brief = task.resume ? '' : `${(options.brief ?? defaultBrief)(describeMembers(task.env))}\n\n`;
          const run = startRun(lead, {
            ...task,
            prompt: `${brief}${task.prompt}`,
            budget: undefined,
            mcpServers: [...(task.mcpServers ?? []), server.mcpServer],
          });
          leadRun = run;
          if (stopped) run.abort();
          let done: AgentResult | undefined;
          for await (const event of run) {
            if (event.type === 'done') done = event.result;
            else if (event.type === 'usage') {
              leadUsage = event.usage;
              if (event.costUsd !== undefined) leadCost = event.costUsd;
              usageChanged();
            } else {
              if (event.type === 'rate-limit') noteLimit(lead.name, event.limit);
              events.push(event);
              await events.room();
            }
          }
          own = done ?? (await run.result);
          if (own.usage) leadUsage = own.usage;
          if (own.costUsd !== undefined) leadCost = own.costUsd;
          // A lead that reports usage only at the end can still take the pack over its budget.
          if (own.usage || own.costUsd !== undefined) usageChanged();
        } finally {
          // The lead is gone: nobody is left to wait for, merge or steer what still runs.
          ended.abort();
          // A delegation still setting up sees the run ended and removes its worktree.
          await Promise.allSettled([...settingUp]);
          for (const sub of mine) sub.run?.abort();
          await Promise.all([...mine].map((sub) => sub.ended));
          await server.close();
        }
        const sum = total();
        return {
          ...(overBudget
            ? { ...failed(overBudget, { kind: 'budget' }), sessionId: own.sessionId, text: own.text }
            : own),
          ...sum,
        };
      })();
      const settled = result
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          events.push({ type: 'error', message });
          return failed(message);
        })
        .then((final) => {
          events.push({ type: 'done', result: final });
          events.close();
          return final;
        });
      return {
        result: settled,
        pack: {
          lead: lead.name,
          maxParallel,
          task(id) {
            const sub = subs.get(id);
            return sub && mine.has(sub) ? report(sub) : undefined;
          },
          async act(id, action) {
            const sub = find(id);
            if (!mine.has(sub)) throw new PackActionError('missing', `Task ${id} belongs to another turn.`);
            switch (action.type) {
              case 'steer':
                return steer(sub, action.text);
              case 'stop':
                return stop(sub);
              case 'diff':
                return diff(sub);
              case 'merge':
                return merge(sub);
              case 'discard':
                return discard(sub);
            }
          },
        },
        abort() {
          stopped = true;
          stopAll();
        },
        ...(lead.capabilities.steer
          ? {
              steer: (text: string) =>
                leadRun?.steer ? leadRun.steer(text) : Promise.reject(new Error('The agent cannot take input now.')),
            }
          : {}),
        [Symbol.asyncIterator]: () => events.iterate(),
      };
    },
  };
}
