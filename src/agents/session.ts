import { addUsage, remainingBudget } from './usage.js';
import type { TokenUsage } from '../core/types.js';
import { shouldFailOver } from './failover.js';
import { packApproval, PackActionError, type PackAction, type PackControls, type PackTask } from './pack.js';
import { artifactLines, HANDOFF_DIR, handoffPreamble, writeHandoff } from './handoff.js';
import { PUBLISH_ARTIFACT_TOOL, type ArtifactStore } from './artifacts.js';
import { markQuestionChannelServer } from './ask-user.js';
import { OPEN_PROJECT_TOOL } from './sessions/workspace.js';
import { shownAnswers } from './live-agent.js';
import type {
  AgentBudget,
  AgentEvent,
  AgentFailure,
  AgentMode,
  AgentResult,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  ApprovalRequest,
  Artifact,
  CodingAgent,
  McpServer,
  QuestionAnswers,
  QuestionHandler,
  RateLimit,
} from './types.js';

/** One item of a turn's transcript, built from the run's `AgentEvent`s. */
export type SessionEntry =
  | { kind: 'text'; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id?: string;
      name: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
      done: boolean;
    }
  /** Files the agent changed; `diff` is the change as a unified patch, when the agent gave one. */
  | { kind: 'files'; paths: string[]; diff?: string }
  /** The agent published something to look at; the content is in the session's `ArtifactStore`. */
  | { kind: 'artifact'; artifact: Artifact }
  /** `automatic`: decided by the task's `permissions.approval`, without asking. */
  | {
      kind: 'approval';
      request: ApprovalRequest;
      decision?: ApprovalDecision;
      automatic?: boolean;
      /** A question's answers (`request.kind === 'question'`), secrets masked. */
      answers?: QuestionAnswers;
    }
  | { kind: 'input'; text: string }
  | { kind: 'error'; message: string }
  /** The turn failed with `failure`, so the session moved to `to` and runs the prompt again there. */
  | { kind: 'failover'; from: string; to: string; failure: AgentFailure };

/** A file the user sent with a prompt, as the chat shows it. */
export interface TurnAttachment {
  name: string;
  /** MIME type, e.g. `image/png`. Empty when unknown. */
  mediaType: string;
  size: number;
  /** Where the chat can load it from, for a thumbnail or a player. */
  url?: string;
}

/** One prompt sent to the agent and everything it did about it. */
export interface SessionTurn {
  id: number;
  agent: string;
  prompt: string;
  /** Files sent with the prompt. */
  attachments?: TurnAttachment[];
  entries: SessionEntry[];
  startedAt: number;
  endedAt?: number;
  result?: AgentResult;
  /** The turn's latest usage report. Agents report running totals, not increments. */
  usage?: TokenUsage;
  costUsd?: number;
  /** Earlier turns this turn's agent was told about after `setAgent()`. */
  handoff?: { turns: number; agents: string[]; file?: string };
  /** Work delegated during this turn, in delegation order. */
  pack?: { lead: string; maxParallel: number; budget?: AgentBudget; tasks: PackTask[]; interactive: boolean };
}

export interface SessionState {
  agent: string;
  cwd: string;
  model?: string;
  effort?: string;
  /** Planning mode for the next turn (`setMode()`). Absent: default. */
  mode?: AgentMode;
  /** The agent's own session id. The next turn resumes it when the agent supports `resume`. */
  sessionId?: string;
  status: 'idle' | 'running';
  turns: SessionTurn[];
  /** Prompts waiting for the running turn to end. */
  queued: string[];
  /** Host notes (`send(text, { note: true })`) waiting for a turn; they run before `queued`. */
  notes?: string[];
  /** Approval requests waiting for `approve()`. */
  approvals: ApprovalRequest[];
  usage: TokenUsage;
  costUsd?: number;
  /** Caps on the whole session's `usage` and `costUsd` (`AgentSessionOptions.budget`). */
  budget?: AgentBudget;
  /** The current agent's latest report per plan or account limit (`rate-limit` events). Cleared by `setAgent()`. */
  rateLimits?: RateLimit[];
  /** Agents a failed turn moves to, in order (`AgentSessionOptions.fallback`). Absent: no failover. */
  fallback?: string[];
  /** Whether `send()` during a turn reaches the running agent instead of the queue. */
  canSteer: boolean;
  /** Whether the current agent can ask the person to choose (own tool, or `ask_user` over MCP). */
  canAsk?: boolean;
  /** Set when earlier turns of this conversation were omitted (e.g. `maxTurns` cap or resuming a truncated session). */
  truncatedReason?: string;
}

export interface AgentSessionOptions {
  agent: CodingAgent;
  cwd: string;
  model?: string;
  effort?: string;
  /** Initial collaboration / planning mode (`'plan'` or `'default'`). */
  mode?: AgentMode;
  /** Continue this agent session on the first turn. */
  resume?: string;
  /** Task fields applied to every turn (env, timeoutMs, maxTurns, mcpServers, extraArgs). */
  task?: Omit<
    AgentTask,
    'prompt' | 'cwd' | 'model' | 'effort' | 'mode' | 'resume' | 'signal' | 'onApproval' | 'onQuestion'
  >;
  /**
   * Decide approvals without asking. Return undefined to leave the request pending until
   * `approve()` is called. Without it every request waits for `approve()`.
   */
  autoApprove?(request: ApprovalRequest): ApprovalDecision | undefined;
  /**
   * Rewrites each prompt just before it reaches the agent, e.g. to add context the user should
   * not see. Turns, queued prompts and steering input keep the text given to `send()`.
   */
  transformPrompt?(prompt: string): string;
  /**
   * Caps on the whole session: tokens and cost summed over every turn. Each turn runs with
   * what is left as its `task.budget`; once a cap is used up, new turns fail without starting.
   */
  budget?: AgentBudget;
  /**
   * Opt-in failover. When a turn fails because its agent is out (quota, sign-in, missing CLI,
   * crash; see `shouldFailOver`), the session switches to the first agent here it has not tried
   * for this prompt and runs the prompt again. The new agent stays for later turns. A stop, a
   * spent budget and other failures never fail over. Without it, nothing changes.
   */
  fallback?: readonly CodingAgent[];
  /**
   * What the fallback agent gets when it takes over a turn, instead of the turn's prompt. The new
   * agent starts its own session, so this can brief it again: `prompt` is the failed turn's text as
   * given to `send()`, `earlier` the finished turns before it. Its result is not passed through
   * `transformPrompt`.
   */
  failoverPrompt?(prompt: string, earlier: readonly SessionTurn[]): string;
  /**
   * What an agent hears, after `setAgent()` or a failover, about the turns it did not run.
   * Default on: a recap goes before its next prompt, and the full transcript (tool calls,
   * output, changed files) is written to `dir` (relative to cwd, default `.genaicode/handoff`)
   * for it to read on demand. Switching back to an agent resumes its own session and tells it
   * only what it missed. `false`: every switch starts the agent fresh, with no context.
   */
  handoff?: boolean | { dir?: string };
  /**
   * Let the agent publish artifacts (pages, images, documents) for the user to look at: the
   * result of `startArtifactChannel()`, or a store plus the MCP server your app mounts its
   * `tool()` on. Agents that take MCP servers get `mcpServer` on every turn, and each publish
   * adds an `artifact` entry to the turn that made it. Serving the content is the host's job
   * (`store.read()` with `artifactResponse()`).
   */
  artifacts?: { store: ArtifactStore; mcpServer?: McpServer };
  /**
   * Give agents that have no way of their own to ask the person (no `capabilities.questions`)
   * the `ask_user` tool: the result of `startQuestionChannel()`. Its questions wait in
   * `approvals` like the agent's own, for `answer()`, in the turn that is running.
   */
  questions?: { mcpServer: McpServer; bind(handler: QuestionHandler | undefined): void };
  /**
   * Give local MCP agents `open_project` while `enabled()` is true (neutral home or unresolved
   * directory), so the agent can offer to move the conversation into a project via a question card.
   */
  openProject?: { mcpServer: McpServer; enabled(): boolean; bind(handler: QuestionHandler | undefined): void };
  /** Longest tool output kept per call, in characters. Default 4,000. */
  maxToolOutput?: number;
  /** Most turns kept in state. Older turns are dropped. Default 200. */
  maxTurns?: number;
}

/**
 * A multi-turn conversation with a coding agent, for chat front ends.
 *
 * `send()` starts a turn when idle. While a turn runs it steers the agent where the agent
 * supports that, and queues the prompt otherwise; queued prompts run in order afterwards.
 * Each turn after the first resumes the agent's own session (`capabilities.resume`).
 * State is an immutable snapshot: every change produces a new object and notifies
 * subscribers, so UIs can compare by reference.
 */
export interface AgentSession {
  get(): SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /**
   * Start, steer, or queue a prompt. Empty text is ignored. `note` marks a message from the
   * host app (an action's outcome): it is never steered, runs before the queued prompts, and is
   * kept when the user stops the turn, to run before their next prompt. `queue` waits for its
   * own turn instead of steering a running one.
   */
  send(text: string, options?: { note?: boolean; queue?: boolean }): void;
  /**
   * Queue a host context block for the next prompt without starting a turn (for example, a reply
   * from another session). Prepended once on the next turn or live steer, preserved if that turn
   * fails over or the steer falls back to the queue, and cleared by `reset()`, `clear()`,
   * `adopt()`, or a fresh agent switch (`handoff: false`).
   */
  addContext(text: string): void;
  /** Stop the running turn and drop queued prompts. */
  stop(): void;
  /** Answer a pending approval request. Returns false when no such request is pending. */
  approve(id: string, decision: ApprovalDecision): boolean;
  /**
   * Answer a pending question of the agent (a request of `kind: 'question'` in `approvals`):
   * the chosen option labels or typed text per question id. `approve(id, 'deny')` declines it.
   * Returns false when no such question is pending.
   */
  answer(id: string, answers: QuestionAnswers): boolean;
  /**
   * Ask the person about something the host app does for the running turn (a tool of its own):
   * the request joins `approvals` like the agent's, and `autoApprove` decides it the same way.
   * Resolves 'deny' when no turn runs, or once the turn ends unanswered.
   */
  ask(request: ApprovalRequest): Promise<ApprovalDecision>;
  /** Operate on a delegated task in its original turn. A diff is returned only to the caller. */
  actOnPackTask?(turnId: number, id: string, action: PackAction): Promise<string>;
  /**
   * Switch agents. The next turn resumes the agent's own earlier session when it had one, and
   * hands over the turns it missed (see `AgentSessionOptions.handoff`). `{ handoff: false }`
   * starts it fresh with no context. A running turn finishes with the agent that started it.
   */
  setAgent(agent: CodingAgent, options?: { handoff?: boolean }): void;
  setModel(model: string | undefined): void;
  /** Change the reasoning effort, from the next turn. Throws for a level the agent does not list. */
  setEffort(effort: string | undefined): void;
  /** Change the planning mode (`'plan'` or `'default'` / undefined), from the next turn. Throws when the agent has no Plan mode. */
  setMode(mode: AgentMode | undefined): void;
  /** Change the failover agents (`AgentSessionOptions.fallback`). Empty or undefined turns failover off. */
  setFallback(agents: readonly CodingAgent[] | undefined): void;
  /** Change the session budget. It applies from the next turn. */
  setBudget(budget: AgentBudget | undefined): void;
  /**
   * Move the conversation to another working directory. Agent sessions cannot change `cwd`
   * mid-session, so the next turn starts a fresh agent session in `cwd`, handing over the
   * conversation so far unless `{ handoff: false }`. May be called during a running turn (e.g.
   * from `open_project`): the running turn's session id is forgotten when it ends.
   */
  setCwd(cwd: string, options?: { handoff?: boolean }): boolean;
  /** Forget the agent sessions so the next turn starts fresh, without a handoff. Keeps the transcript. */
  reset(): void;
  /**
   * Start a new conversation: `reset()`, and the transcript and what waits for a turn are dropped
   * too. Usage and the budget stay. Returns false while a turn is running.
   */
  clear(options?: { cwd?: string }): boolean;
  /**
   * Take over a conversation that happened elsewhere (`readSession()` gives the turns of another
   * agent's session). The turns join the transcript (or replace it when `replace` is true), and
   * the next turn hands them over to the current agent the way a switch does. With `sessionId`,
   * the turns are the current agent's own session: the next turn resumes it instead
   * (`capabilities.resume`), with nothing to hand over. Returns false while a turn is running.
   * With `mode: 'plan'`, restores Plan mode when the agent supports it and no mode is set yet.
   */
  adopt(
    turns: readonly SessionTurn[],
    options?: { sessionId?: string; mode?: AgentMode; cwd?: string; replace?: boolean; truncatedReason?: string },
  ): boolean;
  /** Resolves when no turn is running and nothing is queued. */
  idle(): Promise<void>;
  /** Stop everything and drop subscribers. */
  close(): void;
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const maxToolOutput = options.maxToolOutput ?? 4_000;
  const maxTurns = options.maxTurns ?? 200;
  const toAgent = (prompt: string) => (options.transformPrompt ? options.transformPrompt(prompt) : prompt);
  const agentCanAsk = (candidate: CodingAgent): boolean =>
    !!candidate.capabilities.questions ||
    (!!options.questions && !!candidate.capabilities.mcp && !candidate.capabilities.remote);
  let agent = options.agent;
  if (options.mode !== undefined && options.mode !== 'default' && options.mode !== 'plan')
    throw new Error(`Unknown mode "${String(options.mode)}". Expected 'plan' or 'default'.`);
  if (options.mode === 'plan' && !agent.capabilities.plan) throw new Error(`${agent.name} has no Plan mode.`);
  let state: SessionState = {
    agent: agent.name,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    sessionId: options.resume,
    status: 'idle',
    turns: [],
    queued: [],
    notes: [],
    approvals: [],
    usage: {},
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.fallback?.length ? { fallback: options.fallback.map((candidate) => candidate.name) } : {}),
    canSteer: false,
    canAsk: agentCanAsk(agent),
  };
  let fallback: readonly CodingAgent[] = options.fallback ?? [];
  // Agents that failed the current prompt; reset when a prompt starts on its own.
  let tried = new Set<string>();
  // Said to the next agent ahead of a prompt it takes over mid-way.
  let takeover: string | undefined;
  // `failoverPrompt`'s text for the turn that takes over.
  let retryPrompt: string | undefined;
  // What the user steered into the failed turn: the next agent hears it after the prompt.
  let steeredBefore: string | undefined;
  const listeners = new Set<(state: SessionState) => void>();
  const waiting = new Map<string, (decision: ApprovalDecision, answers?: QuestionAnswers) => void>();
  const packRuns = new Map<number, { agent: CodingAgent; controls: PackControls; unsubscribe?: () => void }>();
  let checkLifetime = new AbortController();
  let activeReviews = 0;
  const budgetInReview = () =>
    activeReviews > 0 && (state.budget?.maxTokens !== undefined || state.budget?.maxCostUsd !== undefined);
  const idleWaiters: Array<() => void> = [];
  let run: AgentRun | undefined;
  let controller: AbortController | undefined;
  let nextTurnId = 1;
  let closed = false;
  // `options.resume` applies to the first turn as given, so an agent that cannot resume refuses it.
  let explicitResume = options.resume;
  // `reset()`, or a fresh switch to the running agent, during a turn: forget the session that
  // turn reports when it ends.
  let forgetAfterTurn = false;
  let runningAgent: CodingAgent | undefined;
  /** The effort the running turn started with. */
  let runningEffort: string | undefined;
  /** The mode the running turn started with (or inherited from a resumed session). */
  let runningMode: AgentMode | undefined;
  /** Whether the caller changed `mode` since the running turn started. */
  let modeChangedDuringTurn = false;
  /** Set when `setMode(undefined)` explicitly clears an active or saved Plan mode. */
  let modeCleared = false;
  /** Whether the running turn's driver itself accepts steering. */
  let runCanSteer = false;
  /** Prompts waiting for the next turn, paired with the mode selected when each was sent. */
  let queue: Array<{ text: string; mode: AgentMode | undefined; leavePlan: boolean }> = [];
  const enqueue = (text: string, mode: AgentMode | undefined, leavePlan: boolean) => {
    queue = [...queue, { text, mode, leavePlan }];
    set({ queued: queue.map((item) => item.text) });
  };
  const handoffOn = options.handoff !== false;
  const handoffDir = (typeof options.handoff === 'object' && options.handoff.dir) || HANDOFF_DIR;
  const readArtifact = (id: string) => options.artifacts?.store.read(id);
  // Per agent: its own session and the last turn that session knows about.
  const known = new Map<CodingAgent, { sessionId?: string; upTo: number; effort?: string; mode?: AgentMode }>(
    options.resume
      ? [
          [
            options.agent,
            {
              sessionId: options.resume,
              upTo: 0,
              effort: options.effort,
              ...(options.mode !== undefined ? { mode: options.mode } : {}),
            },
          ],
        ]
      : [],
  );
  // Turns after this id are news to the current agent; undefined: it knows everything.
  let missedAfter: number | undefined;
  // `reset()` drops the turns up to here from every later handoff.
  let resetAt = 0;
  // After a user stop, `state.notes` wait for the user's next prompt instead of starting a turn.
  let holdNotes = false;
  // A note's turn that a stop cuts short puts the note back: the agent may not have heard it.
  let nextIsNote = false;
  let noteTurn: { id: number; text: string } | undefined;
  // Host context blocks queued for the next prompt (`addContext()`), preserved across failover and rejected steers.
  const MAX_PENDING_CONTEXT = 10;
  let contextEpoch = 0;
  let pendingContext: string[] = [];
  type ContextBatch = { texts: string[]; epoch: number; restored: boolean };
  let turnContext: ContextBatch[] = [];
  const clearContext = () => {
    contextEpoch += 1;
    pendingContext = [];
    turnContext = [];
  };
  const takeContext = (): ContextBatch | undefined => {
    if (!pendingContext.length) return undefined;
    const batch: ContextBatch = { texts: pendingContext, epoch: contextEpoch, restored: false };
    pendingContext = [];
    return batch;
  };
  const restoreContext = (batches: readonly ContextBatch[]) => {
    const recovered: string[] = [];
    for (const batch of batches) {
      if (batch.restored || batch.epoch !== contextEpoch) continue;
      batch.restored = true;
      recovered.push(...batch.texts);
    }
    if (recovered.length) pendingContext = [...recovered, ...pendingContext].slice(-MAX_PENDING_CONTEXT);
  };
  const shiftNote = (): string => {
    const [next, ...rest] = state.notes ?? [];
    nextIsNote = true;
    set({ notes: rest });
    return next!;
  };
  // Usage of finished turns; the running turn's latest report is added on top.
  let pastUsage: TokenUsage = {};
  let pastCost: number | undefined;

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A failing subscriber must not break the session or other subscribers.
      }
    }
  };

  const updateTurn = (id: number, change: (turn: SessionTurn) => SessionTurn) => {
    set({ turns: state.turns.map((turn) => (turn.id === id ? change(turn) : turn)) });
  };

  const keepTurns = (turns: SessionTurn[], inheritedReason: string | undefined) => {
    const dropped = turns.length > maxTurns;
    const kept = turns.slice(-maxTurns);
    for (const [id, packRun] of packRuns)
      if (!kept.some((turn) => turn.id === id)) {
        packRun.unsubscribe?.();
        packRuns.delete(id);
      }
    const truncatedReason = dropped
      ? `Only the latest ${maxTurns} turns are kept in memory; earlier turns were omitted.`
      : inheritedReason;
    return { turns: kept, truncatedReason };
  };

  const syncPackTask = (turnId: number, id: string) => {
    const task = packRuns.get(turnId)?.controls.task(id);
    if (!task) return;
    updateTurn(turnId, (turn) => {
      if (!turn.pack) return turn;
      const tasks = turn.pack.tasks.slice();
      const index = tasks.findIndex((known) => known.id === id);
      if (index < 0) tasks.push(task);
      else tasks[index] = task;
      return { ...turn, pack: { ...turn.pack, tasks } };
    });
  };

  const addEntry = (id: number, entry: SessionEntry) =>
    updateTurn(id, (turn) => ({ ...turn, entries: [...closeStreaming(turn.entries), entry] }));

  const clip = (text: string | undefined) =>
    text === undefined || text.length <= maxToolOutput ? text : `${text.slice(0, maxToolOutput)}\n… (truncated)`;

  const onEvent = (turnId: number, event: AgentEvent, own: () => boolean) => {
    switch (event.type) {
      case 'subtask-start':
        syncPackTask(turnId, event.id);
        return;
      case 'subtask': {
        const child = event.event;
        if (child.type === 'approval-request') addApproval(turnId, packApproval(event.id, event.agent, child.request));
        if (child.type === 'approval-resolved') onEvent(turnId, { ...child, id: `${event.id}:${child.id}` }, own);
        if (
          ['message', 'tool-start', 'file-change', 'error', 'approval-request', 'approval-resolved', 'done'].includes(
            child.type,
          )
        )
          syncPackTask(turnId, event.id);
        return;
      }
      case 'subtask-update': {
        // A later turn of this pack can merge a task delegated in an earlier one.
        const origin = packRuns.get(turnId);
        for (const [id, run] of packRuns) {
          if (run.agent === origin?.agent && run.controls.task(event.id)) {
            syncPackTask(id, event.id);
            break;
          }
        }
        return;
      }
      case 'session':
        if (!forgetAfterTurn && own()) {
          const patch: Partial<SessionState> = { sessionId: event.sessionId };
          if (event.mode && agent.capabilities.plan) {
            if (runningAgent === agent) runningMode = event.mode;
            if (state.mode === undefined && !modeChangedDuringTurn) patch.mode = event.mode;
            else if (state.status === 'running') patch.canSteer = runCanSteer && state.mode === runningMode;
          }
          set(patch);
        }
        return;
      case 'text-delta':
        updateTurn(turnId, (turn) => {
          const last = turn.entries.at(-1);
          if (last?.kind === 'text' && last.streaming) {
            return { ...turn, entries: [...turn.entries.slice(0, -1), { ...last, text: last.text + event.text }] };
          }
          return { ...turn, entries: [...turn.entries, { kind: 'text', text: event.text, streaming: true }] };
        });
        return;
      case 'message':
        updateTurn(turnId, (turn) => {
          const last = turn.entries.at(-1);
          const entry: SessionEntry = { kind: 'text', text: event.text, streaming: false };
          if (last?.kind === 'text' && last.streaming)
            return { ...turn, entries: [...turn.entries.slice(0, -1), entry] };
          return { ...turn, entries: [...turn.entries, entry] };
        });
        return;
      case 'tool-start':
        addEntry(turnId, { kind: 'tool', id: event.id, name: event.name, input: event.input, done: false });
        return;
      case 'tool-end':
        updateTurn(turnId, (turn) => {
          const at = findOpenTool(turn.entries, event.id, event.name);
          const ended = { output: clip(event.output), isError: event.isError, done: true };
          if (at < 0) {
            const entry: SessionEntry = { kind: 'tool', id: event.id, name: event.name ?? 'tool', ...ended };
            return { ...turn, entries: [...closeStreaming(turn.entries), entry] };
          }
          const entries = [...turn.entries];
          entries[at] = { ...(entries[at] as Extract<SessionEntry, { kind: 'tool' }>), ...ended };
          return { ...turn, entries };
        });
        return;
      case 'file-change':
        addEntry(turnId, { kind: 'files', paths: event.paths, ...(event.diff ? { diff: event.diff } : {}) });
        return;
      case 'approval-request':
        // Usually added by `onApproval`, which holds the pending decision; this covers requests
        // decided without asking (`permissions.approval`).
        addApproval(turnId, event.request);
        return;
      case 'approval-resolved':
        updateTurn(turnId, (turn) => ({
          ...turn,
          entries: turn.entries.map((entry) =>
            entry.kind === 'approval' && entry.request.id === event.id && !entry.decision
              ? {
                  ...entry,
                  decision: event.decision,
                  ...(event.automatic ? { automatic: true } : {}),
                  ...(event.answers ? { answers: event.answers } : {}),
                }
              : entry,
          ),
        }));
        return;
      case 'usage': {
        updateTurn(turnId, (turn) => ({
          ...turn,
          usage: event.usage,
          costUsd: event.costUsd ?? turn.costUsd,
        }));
        const turn = state.turns.find((candidate) => candidate.id === turnId);
        set({
          usage: addUsage(pastUsage, turn?.usage ?? {}),
          costUsd: turn?.costUsd === undefined ? pastCost : (pastCost ?? 0) + turn.costUsd,
        });
        return;
      }
      case 'rate-limit': {
        // A turn of the previous agent still finishing: its limits are not the current agent's.
        if (state.turns.find((turn) => turn.id === turnId)?.agent !== agent.name) return;
        const same = (limit: RateLimit) => limit.window === event.limit.window && limit.name === event.limit.name;
        const known = state.rateLimits ?? [];
        set({
          rateLimits: known.some(same)
            ? known.map((limit) => (same(limit) ? event.limit : limit))
            : [...known, event.limit],
        });
        return;
      }
      case 'error':
        addEntry(turnId, { kind: 'error', message: event.message });
        return;
      case 'budget-warning':
      case 'failover':
      case 'stderr':
      case 'raw':
      case 'done':
        return;
    }
  };

  // A publish lands in the turn that is running; one that arrives late, in the last turn.
  const stopArtifacts = options.artifacts?.store.subscribe((artifact) => {
    const turn = state.turns.at(-1);
    if (!closed && turn) addEntry(turn.id, { kind: 'artifact', artifact });
  });

  const addApproval = (turnId: number, request: ApprovalRequest) => {
    const turn = state.turns.find((candidate) => candidate.id === turnId);
    const known = turn?.entries.some(
      (entry) => entry.kind === 'approval' && entry.request.id === request.id && !entry.decision,
    );
    if (!known) addEntry(turnId, { kind: 'approval', request });
  };

  const onApproval = (turnId: number, request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> => {
    addApproval(turnId, request);
    if (signal?.aborted) return Promise.resolve('deny');
    // Publishing changes nothing on disk, and the store has its own checks: no question for it.
    if (!request.subtaskId && isServerToolRequest(request, options.artifacts?.mcpServer, PUBLISH_ARTIFACT_TOOL))
      return Promise.resolve('approve');
    // `open_project` shows its own confirmation card; no separate tool permission prompt ahead of it.
    if (!request.subtaskId && isServerToolRequest(request, options.openProject?.mcpServer, OPEN_PROJECT_TOOL))
      return Promise.resolve('approve');
    const automatic = options.autoApprove?.(request);
    if (automatic) return Promise.resolve(automatic);
    return new Promise((resolve) => {
      // Withdrawn by the agent, or its turn ended: the question leaves `approvals`.
      const withdraw = () => {
        if (waiting.get(request.id) !== answer) return;
        waiting.delete(request.id);
        set({ approvals: state.approvals.filter((pending) => pending.id !== request.id) });
        resolve('deny');
      };
      const answer = (decision: ApprovalDecision) => {
        signal?.removeEventListener('abort', withdraw);
        resolve(decision);
      };
      signal?.addEventListener('abort', withdraw, { once: true });
      waiting.set(request.id, answer);
      set({ approvals: [...state.approvals, request] });
    });
  };

  // An agent's question: it waits for `answer()` whatever `autoApprove` says, which cannot choose.
  const onQuestion = (
    turnId: number,
    request: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<QuestionAnswers | undefined> => {
    addApproval(turnId, request);
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const withdraw = () => {
        if (waiting.get(request.id) !== answer) return;
        waiting.delete(request.id);
        set({ approvals: state.approvals.filter((pending) => pending.id !== request.id) });
        resolve(undefined);
      };
      const answer = (decision: ApprovalDecision, answers?: QuestionAnswers) => {
        signal?.removeEventListener('abort', withdraw);
        resolve(decision === 'approve' ? (answers ?? {}) : undefined);
      };
      signal?.addEventListener('abort', withdraw, { once: true });
      waiting.set(request.id, answer);
      set({ approvals: [...state.approvals, request] });
    });
  };

  // `ask_user` and `open_project` calls land in the turn that is running; between turns nobody is asked.
  const bindQuestion: QuestionHandler = async (request) => {
    const turn = state.turns.at(-1);
    if (closed || !run || !turn || turn.result) return undefined;
    const answers = await onQuestion(turn.id, request, controller?.signal);
    // No agent event follows a question of the session's own tool: its entry records the answer here.
    const shown = shownAnswers(request, answers);
    updateTurn(turn.id, (asked) => ({
      ...asked,
      entries: asked.entries.map((entry) =>
        entry.kind === 'approval' && entry.request.id === request.id && !entry.decision
          ? { ...entry, decision: answers ? 'approve' : 'deny', ...(shown ? { answers: shown } : {}) }
          : entry,
      ),
    }));
    return answers;
  };
  options.questions?.bind(bindQuestion);
  options.openProject?.bind(bindQuestion);

  const denyPending = () => {
    for (const resolve of waiting.values()) resolve('deny');
    waiting.clear();
    if (state.approvals.length) set({ approvals: [] });
  };

  const settleIdle = () => {
    if (state.status !== 'idle' || state.queued.length || budgetInReview()) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const switchAgent = (next: CodingAgent, carry = handoffOn) => {
    agent = next;
    explicitResume = undefined;
    if (!carry && runningAgent === next) forgetAfterTurn = true;
    const before = carry ? known.get(next) : undefined;
    const sessionId = before?.sessionId && next.capabilities.resume ? before.sessionId : undefined;
    // Without its own session the agent missed the whole conversation.
    missedAfter = carry ? Math.max(resetAt, sessionId ? before!.upTo : 0) : undefined;
    if (!carry) known.delete(next);
    // Limits belong to the agent that reported them.
    // An effort is a word of the agent's own: one the next agent does not know goes back to its default.
    const effort =
      // A session that keeps its effort is resumed at the one it started with: its running turn's, or its last one's.
      next.capabilities.effortAtStart && carry && runningAgent === next
        ? runningEffort
        : sessionId && next.capabilities.effortAtStart
          ? before!.effort
          : state.effort !== undefined && next.capabilities.effort?.includes(state.effort)
            ? state.effort
            : undefined;
    const mode = state.mode !== undefined && next.capabilities.plan ? state.mode : undefined;
    modeCleared = false;
    set({ agent: next.name, sessionId, rateLimits: [], effort, mode, canAsk: agentCanAsk(next) });
  };

  /** After a turn: switch agents and return true when the failure is one another agent can get past. */
  const failOver = (turnId: number, result: AgentResult, turnMode: AgentMode | undefined): boolean => {
    const failed = state.turns.find((turn) => turn.id === turnId);
    if (closed || !failed || failed.agent !== agent.name || !shouldFailOver(result)) return false;
    const needsPlan = turnMode === 'plan' || state.mode === 'plan' || queue.some((item) => item.mode === 'plan');
    tried.add(agent.name);
    const next = fallback.find(
      (candidate) =>
        candidate.name !== agent.name && !tried.has(candidate.name) && (!needsPlan || candidate.capabilities.plan),
    );
    if (!next) return false;
    addEntry(turnId, { kind: 'failover', from: agent.name, to: next.name, failure: result.failure! });
    const changed = [...new Set(failed.entries.flatMap((entry) => (entry.kind === 'files' ? entry.paths : [])))];
    const did: string[] = [];
    if (changed.length)
      did.push(`It already changed: ${changed.join(', ')}. Check those files and continue from there.`);
    // The user already sees these; their content may exist nowhere but in the store.
    const shown = artifactLines([failed]);
    if (shown.length) {
      did.push(
        `It already showed the user these artifacts (publish_artifact with the same name replaces one):\n${shown.join('\n')}`,
      );
      if (handoffOn) {
        try {
          const file = writeHandoff(state.cwd, handoffDir, next.name, [failed], readArtifact);
          did.push(`What it did before stopping, with the content of those artifacts, is in \`${file}\`.`);
        } catch {
          // An unwritable cwd still gets the list.
        }
      }
    }
    takeover = did.length
      ? `${agent.name} stopped part-way through this request (${result.failure!.kind}). ${did.join('\n')}\n\n`
      : undefined;
    const steered = failed.entries.flatMap((entry) => (entry.kind === 'input' ? [entry.text] : []));
    steeredBefore = steered.length
      ? `\n\nWhile ${agent.name} worked on it, the user added:\n${steered.map((text) => `- ${text}`).join('\n')}`
      : undefined;
    retryPrompt = undefined;
    if (options.failoverPrompt) {
      const earlier = state.turns.filter(
        (turn) => turn.id < turnId && turn.result && turn.entries.at(-1)?.kind !== 'failover',
      );
      try {
        retryPrompt = options.failoverPrompt(failed.prompt, earlier);
      } catch {
        // The turn's own prompt, as without the hook.
      }
    }
    switchAgent(next);
    // The failed turn is over: the next agent's session is one to keep.
    forgetAfterTurn = false;
    // Another vendor's model name means nothing to the next agent; its default applies.
    if (state.model !== undefined) set({ model: undefined });
    return true;
  };

  const startTurn = (
    prompt: string,
    retry = false,
    pinnedMode?: { mode: AgentMode | undefined; leavePlan?: boolean },
  ) => {
    holdNotes = false;
    if (!retry) {
      tried = new Set();
      takeover = undefined;
    }
    const prefix = takeover ?? '';
    const rewritten = retry ? retryPrompt : undefined;
    const suffix = (retry && steeredBefore) || '';
    takeover = undefined;
    retryPrompt = undefined;
    steeredBefore = undefined;
    const turnId = nextTurnId++;
    noteTurn = nextIsNote ? { id: turnId, text: prompt } : undefined;
    nextIsNote = false;
    const turnAgent = agent;
    const turnEffort = state.effort;
    const turnLeavePlan = pinnedMode ? Boolean(pinnedMode.leavePlan) : modeCleared;
    // A follow-up queued before a resumed turn reported Plan (`mode: undefined, leavePlan: false`)
    // inherits the session's Plan mode rather than leaving it.
    const turnMode: AgentMode | undefined = pinnedMode
      ? (pinnedMode.mode ?? (!turnLeavePlan && known.get(turnAgent)?.mode === 'plan' ? 'plan' : undefined))
      : state.mode;
    if (!pinnedMode) modeCleared = false;
    runningEffort = turnEffort;
    runningAgent = turnAgent;
    runningMode = turnMode;
    modeChangedDuringTurn = false;
    runCanSteer = false;
    const own = () => agent === turnAgent;
    let preamble = '';
    let handoff: SessionTurn['handoff'];
    if (missedAfter !== undefined && rewritten === undefined) {
      const from = missedAfter;
      // The attempt being retried is this prompt itself (and the takeover note), not history.
      const retried = retry ? state.turns.at(-1)?.id : undefined;
      const missed = state.turns.filter((past) => past.id > from && past.id !== retried);
      if (missed.length) {
        let file: string | undefined;
        try {
          file = writeHandoff(state.cwd, handoffDir, agent.name, missed, readArtifact);
        } catch {
          // An unwritable cwd still gets the recap.
        }
        preamble = handoffPreamble(missed, file);
        handoff = { turns: missed.length, agents: [...new Set(missed.map((past) => past.agent))], file };
      }
    }
    const turn: SessionTurn = {
      id: turnId,
      agent: agent.name,
      prompt,
      entries: [],
      startedAt: Date.now(),
      ...(handoff ? { handoff } : {}),
    };
    const resume =
      explicitResume !== undefined
        ? explicitResume
        : state.sessionId && agent.capabilities.resume
          ? state.sessionId
          : undefined;
    explicitResume = undefined;
    const turnController = new AbortController();
    controller = turnController;
    const { turns: nextTurns, truncatedReason } = keepTurns([...state.turns, turn], state.truncatedReason);
    set({
      status: 'running',
      turns: nextTurns,
      truncatedReason,
      canSteer: false,
    });
    const leavingPlan =
      turnMode === undefined &&
      turnLeavePlan &&
      resume !== undefined &&
      Boolean(turnAgent.capabilities.plan) &&
      known.get(turnAgent)?.mode === 'plan';
    const taskMode: AgentMode | undefined =
      turnMode === 'plan'
        ? 'plan'
        : (turnMode === 'default' && Boolean(turnAgent.capabilities.plan)) || leavingPlan
          ? 'default'
          : undefined;
    let current: AgentRun;
    let contextBatch: ContextBatch | undefined;
    const left = remainingBudget(state.budget, state.usage, state.costUsd);
    try {
      if (left?.spent) throw new Error(left.spent);
      if (turnMode === 'plan' && !turnAgent.capabilities.plan)
        throw new Error(`${turnAgent.name} does not support Plan mode.`);
      const budget = tighterBudget(left?.budget, options.task?.budget);
      const baseServers = options.task?.mcpServers ?? [];
      const extraServers: McpServer[] = [];
      if (turnAgent.capabilities.mcp) {
        if (options.artifacts?.mcpServer) extraServers.push(options.artifacts.mcpServer);
        if (options.openProject && !turnAgent.capabilities.remote && options.openProject.enabled())
          extraServers.push(options.openProject.mcpServer);
        if (options.questions && !turnAgent.capabilities.questions && !turnAgent.capabilities.remote) {
          const taken = new Set([...baseServers, ...extraServers].map((server) => server.name));
          const baseName = options.questions.mcpServer.name;
          let name = baseName;
          for (let n = 2; taken.has(name); n++) name = `${baseName}_${n}`;
          extraServers.push(markQuestionChannelServer({ ...options.questions.mcpServer, name }));
        }
      }
      const basePrompt = rewritten ?? toAgent(prompt);
      contextBatch = takeContext();
      const contextPrefix = contextBatch ? `${contextBatch.texts.join('\n\n')}\n\n` : '';
      current = turnAgent.run({
        ...options.task,
        ...(extraServers.length ? { mcpServers: [...baseServers, ...extraServers] } : {}),
        ...(budget ? { budget } : {}),
        ...(taskMode ? { mode: taskMode } : {}),
        prompt: preamble + prefix + contextPrefix + basePrompt + suffix,
        cwd: state.cwd,
        model: state.model,
        effort: turnEffort,
        resume,
        signal: turnController.signal,
        onApproval: (request, signal) => onApproval(turnId, request, signal),
        onQuestion: (request, signal) => onQuestion(turnId, request, signal),
      });
      turnContext = contextBatch ? [contextBatch] : [];
      if (current.pack) {
        const { lead, maxParallel } = current.pack;
        packRuns.set(turnId, {
          agent: turnAgent,
          controls: current.pack,
          unsubscribe: current.pack.onTaskChange?.((id) => syncPackTask(turnId, id)),
        });
        updateTurn(turnId, (started) => ({
          ...started,
          pack: { lead, maxParallel, budget, tasks: [], interactive: true },
        }));
      }
    } catch (error) {
      if (contextBatch) restoreContext([contextBatch]);
      turnContext = [];
      // A throwing transformPrompt (or driver) fails this turn; the queue goes on as usual.
      current = failedRun(error instanceof Error ? error.message : String(error));
    }
    run = current;
    runCanSteer = Boolean(current.steer && turnAgent.capabilities.steer);
    if (runCanSteer && state.mode === runningMode) set({ canSteer: true });
    let turnSession: string | undefined;
    let turnSessionMode: AgentMode | undefined;
    void (async () => {
      try {
        for await (const event of current) {
          if (event.type === 'session') {
            turnSession = event.sessionId;
            if (event.mode) turnSessionMode = event.mode;
          }
          onEvent(turnId, event, own);
        }
      } catch (error) {
        addEntry(turnId, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      const result = await current.result;
      const noteTurnWas = noteTurn?.id === turnId;
      if (noteTurnWas) noteTurn = undefined;
      denyPending();
      run = undefined;
      controller = undefined;
      runCanSteer = false;
      runningMode = undefined;
      updateTurn(turnId, (done) => ({
        ...done,
        entries: closeStreaming(done.entries),
        result,
        endedAt: Date.now(),
      }));
      const finished = state.turns.find((candidate) => candidate.id === turnId);
      if (finished?.usage) pastUsage = addUsage(pastUsage, finished.usage);
      if (finished?.costUsd !== undefined) pastCost = (pastCost ?? 0) + finished.costUsd;
      set({ usage: pastUsage, costUsd: pastCost });
      // A quota known only from an error is over once a turn gets through again.
      if (result.ok && state.rateLimits?.some((limit) => limit.window === 'quota'))
        set({ rateLimits: state.rateLimits.filter((limit) => limit.window !== 'quota') });
      runningAgent = undefined;
      const effectiveMode = turnSessionMode ?? turnMode;
      // A resumed turn that names no new session continued the one it resumed.
      const sessionId = result.sessionId ?? turnSession ?? (result.ok ? resume : undefined);
      if (forgetAfterTurn) {
        forgetAfterTurn = false;
        if (own()) set({ sessionId: undefined });
      } else {
        // The agent heard everything up to this turn, through its session or this turn's handoff.
        if (sessionId || result.ok)
          known.set(turnAgent, { sessionId, upTo: turnId, effort: turnEffort, mode: effectiveMode });
        if (own()) {
          if (sessionId || result.ok) missedAfter = undefined;
          if (sessionId) set({ sessionId });
        }
      }
      const activeContext = turnContext;
      turnContext = [];
      if (failOver(turnId, result, effectiveMode)) {
        // Restore host context delivered to the failed turn so the fallback agent hears it too.
        restoreContext(activeContext);
        // The same prompt again, on the next agent; a note stays a note.
        if (finished && noteTurnWas) nextIsNote = true;
        return startTurn(finished!.prompt, true, { mode: effectiveMode });
      }
      const next = closed ? undefined : takeNext();
      if (next !== undefined) {
        startTurn(next.prompt, false, next.pinnedMode);
      } else {
        set({ status: 'idle', canSteer: false });
        settleIdle();
      }
    })();
  };

  const takeNext = ():
    | { prompt: string; pinnedMode?: { mode: AgentMode | undefined; leavePlan?: boolean } }
    | undefined => {
    if (state.notes?.length && !holdNotes) return { prompt: shiftNote() };
    const [next, ...rest] = queue;
    if (!next) return undefined;
    queue = rest;
    set({ queued: queue.map((item) => item.text) });
    return { prompt: next.text, pinnedMode: { mode: next.mode, leavePlan: next.leavePlan } };
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(text, sendOptions) {
      const prompt = text.trim();
      if (!prompt || closed) return;
      if (sendOptions?.note) {
        set({ notes: [...(state.notes ?? []), prompt] });
        // A new note releases the held ones, oldest first: now, or as the running turn ends.
        holdNotes = false;
        if (state.status === 'idle' && !budgetInReview()) return startTurn(shiftNote());
        return;
      }
      holdNotes = false;
      const wantedMode = state.mode;
      const wantedLeavePlan = modeCleared;
      if (state.status === 'idle' && !budgetInReview()) {
        // Held notes go first: the agent hears what happened before the user's next words.
        if (!state.notes?.length) return startTurn(prompt);
        enqueue(prompt, wantedMode, wantedLeavePlan);
        modeCleared = false;
        return startTurn(shiftNote());
      }
      const current = run;
      const turnId = state.turns.at(-1)?.id;
      const turnController = controller;
      // Transform only what is steered now; a queued prompt is transformed when its turn starts.
      let steerText: string | undefined;
      let steerContext: ContextBatch | undefined;
      if (
        current?.steer &&
        state.canSteer &&
        state.mode === runningMode &&
        turnId !== undefined &&
        !sendOptions?.queue
      ) {
        try {
          const transformed = toAgent(prompt);
          steerContext = takeContext();
          steerText = steerContext ? `${steerContext.texts.join('\n\n')}\n\n${transformed}` : transformed;
        } catch {
          // Queued instead: its turn reports the failure.
        }
      }
      if (current?.steer && turnId !== undefined && steerText !== undefined) {
        if (steerContext) turnContext.push(steerContext);
        addEntry(turnId, { kind: 'input', text: prompt });
        current.steer(steerText).catch(() => {
          // The turn ended before the agent took the input: run it as the next turn instead,
          // unless the user stopped that turn.
          if (closed || turnController?.signal.aborted) return;
          if (steerContext) restoreContext([steerContext]);
          enqueue(prompt, wantedMode, wantedLeavePlan);
          if (state.status === 'idle' && !budgetInReview()) {
            const next = takeNext();
            if (next !== undefined) startTurn(next.prompt, false, next.pinnedMode);
          }
        });
        return;
      }
      enqueue(prompt, wantedMode, wantedLeavePlan);
      modeCleared = false;
    },
    addContext(text) {
      const item = text.trim();
      if (!item || closed) return;
      pendingContext = [...pendingContext, item].slice(-MAX_PENDING_CONTEXT);
    },
    stop() {
      checkLifetime.abort();
      if (!closed) checkLifetime = new AbortController();
      if (queue.length || state.queued.length) {
        queue = [];
        set({ queued: [] });
      }
      if (noteTurn) {
        set({ notes: [noteTurn.text, ...(state.notes ?? [])] });
        noteTurn = undefined;
      }
      holdNotes = true;
      denyPending();
      controller?.abort();
      run?.abort();
      settleIdle();
    },
    async ask(request) {
      const turn = state.turns.at(-1);
      if (closed || !run || !turn || turn.result) return 'deny';
      const automatic = !!options.autoApprove?.(request);
      const decision = await onApproval(turn.id, request);
      // No agent event follows a question of the host's own: its entry records the answer here.
      updateTurn(turn.id, (asked) => ({
        ...asked,
        entries: asked.entries.map((entry) =>
          entry.kind === 'approval' && entry.request.id === request.id && !entry.decision
            ? { ...entry, decision, ...(automatic ? { automatic: true } : {}) }
            : entry,
        ),
      }));
      return decision;
    },
    approve(id, decision) {
      const resolve = waiting.get(id);
      // Only a decision the agent understands takes the request away (JS callers can pass anything).
      if (!resolve || (decision !== 'approve' && decision !== 'deny')) return false;
      waiting.delete(id);
      set({ approvals: state.approvals.filter((request) => request.id !== id) });
      resolve(decision);
      return true;
    },
    answer(id, answers) {
      const resolve = waiting.get(id);
      if (!resolve || !state.approvals.some((request) => request.id === id && request.kind === 'question'))
        return false;
      waiting.delete(id);
      set({ approvals: state.approvals.filter((request) => request.id !== id) });
      resolve('approve', answers);
      return true;
    },
    async actOnPackTask(turnId, id, action) {
      const controls = packRuns.get(turnId)?.controls;
      if (closed || !controls?.task(id)) throw new PackActionError('missing', `No pack task ${id} in turn ${turnId}.`);
      const reviewing = action.type === 'review';
      const left = reviewing ? remainingBudget(state.budget, state.usage, state.costUsd) : undefined;
      if (left?.spent) throw new PackActionError('budget', left.spent);
      if (left?.budget && (activeReviews || state.status !== 'idle')) throw new PackActionError('budget-busy');
      if (reviewing) activeReviews++;
      try {
        if (reviewing || action.type === 'verify') {
          return await controls.act(id, action, {
            signal: checkLifetime.signal,
            budget: tighterBudget(left?.budget, options.task?.budget),
            onReviewUsage(usage, costUsd) {
              if (usage) pastUsage = addUsage(pastUsage, usage);
              if (costUsd !== undefined) pastCost = (pastCost ?? 0) + costUsd;
              set({
                usage: usage ? addUsage(state.usage, usage) : state.usage,
                costUsd: costUsd === undefined ? state.costUsd : (state.costUsd ?? 0) + costUsd,
              });
            },
          });
        }
        return await controls.act(id, action);
      } finally {
        if (reviewing) activeReviews--;
        syncPackTask(turnId, id);
        if (reviewing && !activeReviews && state.status === 'idle') {
          const next = !closed && takeNext();
          if (next) startTurn(next.prompt, false, next.pinnedMode);
          else settleIdle();
        }
      }
    },
    setAgent(next, switchOptions) {
      const carry = handoffOn && switchOptions?.handoff !== false;
      if (!carry) clearContext();
      if (next === agent) {
        // Switching to the current agent fresh is a reset of its session.
        if (!carry) {
          explicitResume = undefined;
          known.delete(next);
          missedAfter = undefined;
          if (runningAgent === next) forgetAfterTurn = true;
          set({ sessionId: undefined });
        }
        return;
      }
      switchAgent(next, carry);
    },
    setFallback(agents) {
      fallback = agents ?? [];
      set({ fallback: fallback.length ? fallback.map((candidate) => candidate.name) : undefined });
    },
    setModel(model) {
      set({ model });
    },
    setEffort(effort) {
      const levels = agent.capabilities.effort ?? [];
      if (effort !== undefined && !levels.includes(effort))
        throw new Error(
          levels.length
            ? `${agent.name} has no effort "${effort}". It takes: ${levels.join(', ')}.`
            : `${agent.name} takes no effort setting.`,
        );
      // Such an agent would refuse every next prompt of the session it already has.
      // The same while its first turn runs: the session being made already has the effort it got.
      const started = state.sessionId !== undefined || (runningAgent === agent && !forgetAfterTurn);
      if (agent.capabilities.effortAtStart && started && effort !== state.effort)
        throw new Error(`${agent.name} keeps the effort its session started with. /new starts a fresh one.`);
      set({ effort });
    },
    setMode(mode) {
      if (mode !== undefined && mode !== 'default' && mode !== 'plan')
        throw new Error(`Unknown mode "${String(mode)}". Expected 'plan' or 'default'.`);
      if (mode === 'plan' && !agent.capabilities.plan) throw new Error(`${agent.name} has no Plan mode.`);
      modeCleared =
        mode === undefined && (state.mode === 'plan' || runningMode === 'plan' || known.get(agent)?.mode === 'plan');
      const patch: Partial<SessionState> = { mode };
      if (state.status === 'running') {
        modeChangedDuringTurn = true;
        patch.canSteer = runCanSteer && mode === runningMode && !modeCleared;
      }
      set(patch);
    },
    setBudget(budget) {
      set({ budget });
    },
    setCwd(cwd, moveOptions) {
      if (closed) return false;
      if (cwd === state.cwd) return true;
      const carry = handoffOn && moveOptions?.handoff !== false;
      if (!carry) clearContext();
      explicitResume = undefined;
      known.clear();
      missedAfter = carry && state.turns.length ? resetAt : undefined;
      if (state.status === 'running') forgetAfterTurn = true;
      set({ cwd, sessionId: undefined });
      return true;
    },
    reset() {
      clearContext();
      explicitResume = undefined;
      modeCleared = false;
      known.clear();
      missedAfter = undefined;
      resetAt = state.turns.at(-1)?.id ?? 0;
      if (state.status === 'running') forgetAfterTurn = true;
      set({ sessionId: undefined });
    },
    clear(clearOptions) {
      if (state.status === 'running' || closed) return false;
      clearContext();
      explicitResume = undefined;
      modeCleared = false;
      known.clear();
      missedAfter = undefined;
      resetAt = nextTurnId - 1;
      queue = [];
      set({
        sessionId: undefined,
        turns: [],
        queued: [],
        notes: [],
        truncatedReason: undefined,
        ...(clearOptions?.cwd !== undefined ? { cwd: clearOptions.cwd } : {}),
      });
      return true;
    },
    adopt(turns, adoptOptions) {
      if (state.status === 'running' || closed) return false;
      const own = adoptOptions?.sessionId && agent.capabilities.resume ? adoptOptions.sessionId : undefined;
      const nextCwd = adoptOptions?.cwd;
      const cwdChanged = nextCwd !== undefined && nextCwd !== state.cwd;
      const replace = adoptOptions?.replace === true;
      if (!turns.length && !own && !cwdChanged && !replace) return true;
      clearContext();
      if (cwdChanged || replace) {
        explicitResume = undefined;
        known.clear();
      }
      if (replace) {
        queue = [];
        missedAfter = undefined;
        resetAt = nextTurnId - 1;
      }
      const baseTurns = replace ? [] : state.turns;
      const before = baseTurns.at(-1)?.id ?? 0;
      const adopted = turns.map((turn) => {
        // A handoff of its own belongs to the session it came from.
        const copy: SessionTurn = { ...turn, id: nextTurnId++ };
        if (copy.pack) copy.pack = { ...copy.pack, interactive: false };
        delete copy.handoff;
        return copy;
      });
      let inheritedMode: AgentMode | undefined;
      if (own) {
        // Its own session holds these turns; what it missed before them is left behind.
        explicitResume = undefined;
        missedAfter = undefined;
        if (state.mode === undefined && adoptOptions?.mode === 'plan' && agent.capabilities.plan)
          inheritedMode = 'plan';
        known.set(agent, {
          sessionId: own,
          upTo: nextTurnId - 1,
          effort: state.effort,
          mode: inheritedMode ?? state.mode ?? adoptOptions?.mode,
        });
      } else if (adopted.length) {
        // Turns the current agent already missed stay missed.
        missedAfter ??= Math.max(before, resetAt);
      }
      const { turns: nextTurns, truncatedReason } = keepTurns(
        [...baseTurns, ...adopted],
        adoptOptions?.truncatedReason ?? (replace ? undefined : state.truncatedReason),
      );
      set({
        turns: nextTurns,
        truncatedReason,
        ...(replace
          ? { queued: [], notes: [], sessionId: own }
          : own
            ? { sessionId: own }
            : cwdChanged
              ? { sessionId: undefined }
              : {}),
        ...(cwdChanged ? { cwd: nextCwd } : {}),
        ...(inheritedMode ? { mode: inheritedMode } : {}),
      });
      return true;
    },
    idle() {
      if (state.status === 'idle' && !state.queued.length && !budgetInReview()) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    close() {
      closed = true;
      clearContext();
      for (const packRun of packRuns.values()) packRun.unsubscribe?.();
      stopArtifacts?.();
      options.questions?.bind(undefined);
      options.openProject?.bind(undefined);
      if (state.notes?.length) set({ notes: [] });
      this.stop();
      listeners.clear();
      // Workers can still emit their final status as the stopped run drains.
      if (packRuns.size) void this.idle().then(() => packRuns.clear());
    },
  };
}

/** Claude's permission prompt for one of the session's own MCP tools (`publish_artifact`, `open_project`). */
function isServerToolRequest(request: ApprovalRequest, server: McpServer | undefined, tool: string): boolean {
  const detail = request.detail;
  return (
    !!server &&
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { tool_name?: unknown }).tool_name === `mcp__${server.name}__${tool}`
  );
}

/** Both budgets' caps, the lower one where both set the same cap. */
function tighterBudget(session: AgentBudget | undefined, turn: AgentBudget | undefined): AgentBudget | undefined {
  if (!session || !turn) return session ?? turn;
  const lower = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
  const maxTokens = lower(session.maxTokens, turn.maxTokens);
  const maxCostUsd = lower(session.maxCostUsd, turn.maxCostUsd);
  return {
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    // The turn's own warnings stay; the session warns about itself (`budgetStatus`).
    warnAt: turn.warnAt ?? 0.8,
  };
}

/** A run that failed before it started. */
function failedRun(message: string): AgentRun {
  const result: AgentResult = { status: 'failed', ok: false, exitCode: null, signal: null, error: message };
  return {
    result: Promise.resolve(result),
    abort() {},
    async *[Symbol.asyncIterator]() {
      yield { type: 'error', message };
      yield { type: 'done', result };
    },
  };
}

function closeStreaming(entries: SessionEntry[]): SessionEntry[] {
  const last = entries.at(-1);
  if (last?.kind !== 'text' || !last.streaming) return entries;
  return [...entries.slice(0, -1), { ...last, streaming: false }];
}

function findOpenTool(entries: SessionEntry[], id: string | undefined, name: string | undefined): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== 'tool' || entry.done) continue;
    if (id !== undefined ? entry.id === id : name === undefined || entry.name === name) return i;
  }
  return -1;
}
