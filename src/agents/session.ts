import type { TokenUsage } from '../core/types.js';
import type {
  AgentEvent,
  AgentResult,
  AgentRun,
  AgentTask,
  ApprovalDecision,
  ApprovalRequest,
  CodingAgent,
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
  | { kind: 'files'; paths: string[] }
  | { kind: 'approval'; request: ApprovalRequest; decision?: ApprovalDecision }
  | { kind: 'input'; text: string }
  | { kind: 'error'; message: string };

/** One prompt sent to the agent and everything it did about it. */
export interface SessionTurn {
  id: number;
  agent: string;
  prompt: string;
  entries: SessionEntry[];
  startedAt: number;
  endedAt?: number;
  result?: AgentResult;
}

export interface SessionState {
  agent: string;
  cwd: string;
  model?: string;
  effort?: string;
  /** The agent's own session id. The next turn resumes it when the agent supports `resume`. */
  sessionId?: string;
  status: 'idle' | 'running';
  turns: SessionTurn[];
  /** Prompts waiting for the running turn to end. */
  queued: string[];
  /** Approval requests waiting for `approve()`. */
  approvals: ApprovalRequest[];
  usage: TokenUsage;
  costUsd?: number;
  /** Whether `send()` during a turn reaches the running agent instead of the queue. */
  canSteer: boolean;
}

export interface AgentSessionOptions {
  agent: CodingAgent;
  cwd: string;
  model?: string;
  effort?: string;
  /** Continue this agent session on the first turn. */
  resume?: string;
  /** Task fields applied to every turn (env, timeoutMs, maxTurns, mcpServers, extraArgs). */
  task?: Omit<AgentTask, 'prompt' | 'cwd' | 'model' | 'effort' | 'resume' | 'signal' | 'onApproval'>;
  /**
   * Decide approvals without asking. Return undefined to leave the request pending until
   * `approve()` is called. Without it every request waits for `approve()`.
   */
  autoApprove?(request: ApprovalRequest): ApprovalDecision | undefined;
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
  /** Start, steer, or queue a prompt. Empty text is ignored. */
  send(text: string): void;
  /** Stop the running turn and drop queued prompts. */
  stop(): void;
  /** Answer a pending approval request. Returns false when no such request is pending. */
  approve(id: string, decision: ApprovalDecision): boolean;
  /** Switch agents between turns. The next turn starts a fresh session. */
  setAgent(agent: CodingAgent): void;
  setModel(model: string | undefined): void;
  /** Forget the agent session so the next turn starts fresh. Keeps the transcript. */
  reset(): void;
  /** Resolves when no turn is running and nothing is queued. */
  idle(): Promise<void>;
  /** Stop everything and drop subscribers. */
  close(): void;
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const maxToolOutput = options.maxToolOutput ?? 4_000;
  const maxTurns = options.maxTurns ?? 200;
  let agent = options.agent;
  let state: SessionState = {
    agent: agent.name,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    sessionId: options.resume,
    status: 'idle',
    turns: [],
    queued: [],
    approvals: [],
    usage: {},
    canSteer: false,
  };
  const listeners = new Set<(state: SessionState) => void>();
  const waiting = new Map<string, (decision: ApprovalDecision) => void>();
  const idleWaiters: Array<() => void> = [];
  let run: AgentRun | undefined;
  let controller: AbortController | undefined;
  let nextTurnId = 1;
  let closed = false;

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

  const addEntry = (id: number, entry: SessionEntry) =>
    updateTurn(id, (turn) => ({ ...turn, entries: [...closeStreaming(turn.entries), entry] }));

  const clip = (text: string | undefined) =>
    text === undefined || text.length <= maxToolOutput ? text : `${text.slice(0, maxToolOutput)}\n… (truncated)`;

  const onEvent = (turnId: number, event: AgentEvent) => {
    switch (event.type) {
      case 'session':
        set({ sessionId: event.sessionId });
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
        addEntry(turnId, { kind: 'files', paths: event.paths });
        return;
      case 'approval-request':
        // The entry is added by `onApproval`, which also holds the pending decision.
        return;
      case 'approval-resolved':
        updateTurn(turnId, (turn) => ({
          ...turn,
          entries: turn.entries.map((entry) =>
            entry.kind === 'approval' && entry.request.id === event.id ? { ...entry, decision: event.decision } : entry,
          ),
        }));
        return;
      case 'usage':
        set({
          usage: addUsage(state.usage, event.usage),
          costUsd: event.costUsd === undefined ? state.costUsd : (state.costUsd ?? 0) + event.costUsd,
        });
        return;
      case 'error':
        addEntry(turnId, { kind: 'error', message: event.message });
        return;
      case 'stderr':
      case 'raw':
      case 'done':
        return;
    }
  };

  const onApproval = (turnId: number, request: ApprovalRequest): Promise<ApprovalDecision> => {
    addEntry(turnId, { kind: 'approval', request });
    const automatic = options.autoApprove?.(request);
    if (automatic) return Promise.resolve(automatic);
    return new Promise((resolve) => {
      waiting.set(request.id, resolve);
      set({ approvals: [...state.approvals, request] });
    });
  };

  const denyPending = () => {
    for (const resolve of waiting.values()) resolve('deny');
    waiting.clear();
    if (state.approvals.length) set({ approvals: [] });
  };

  const settleIdle = () => {
    if (state.status !== 'idle' || state.queued.length) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const startTurn = (prompt: string) => {
    const turnId = nextTurnId++;
    const turn: SessionTurn = { id: turnId, agent: agent.name, prompt, entries: [], startedAt: Date.now() };
    const resume = state.sessionId && agent.capabilities.resume ? state.sessionId : undefined;
    controller = new AbortController();
    set({
      status: 'running',
      turns: [...state.turns, turn].slice(-maxTurns),
      canSteer: false,
    });
    const current = agent.run({
      ...options.task,
      prompt,
      cwd: state.cwd,
      model: state.model,
      effort: state.effort,
      resume,
      signal: controller.signal,
      onApproval: (request) => onApproval(turnId, request),
    });
    run = current;
    if (current.steer && agent.capabilities.steer) set({ canSteer: true });
    void (async () => {
      try {
        for await (const event of current) onEvent(turnId, event);
      } catch (error) {
        addEntry(turnId, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      const result = await current.result;
      denyPending();
      run = undefined;
      controller = undefined;
      updateTurn(turnId, (done) => ({
        ...done,
        entries: closeStreaming(done.entries),
        result,
        endedAt: Date.now(),
      }));
      if (result.sessionId) set({ sessionId: result.sessionId });
      const [next, ...rest] = state.queued;
      if (next !== undefined && !closed) {
        set({ queued: rest });
        startTurn(next);
      } else {
        set({ status: 'idle', canSteer: false });
        settleIdle();
      }
    })();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(text) {
      const prompt = text.trim();
      if (!prompt || closed) return;
      if (state.status === 'idle') return startTurn(prompt);
      const current = run;
      const turnId = state.turns.at(-1)?.id;
      if (current?.steer && state.canSteer && turnId !== undefined) {
        addEntry(turnId, { kind: 'input', text: prompt });
        current.steer(prompt).catch(() => {
          // The turn ended before the agent took the input: run it as the next turn instead.
          if (closed) return;
          set({ queued: [...state.queued, prompt] });
          if (state.status === 'idle') {
            const [next, ...rest] = state.queued;
            set({ queued: rest });
            if (next !== undefined) startTurn(next);
          }
        });
        return;
      }
      set({ queued: [...state.queued, prompt] });
    },
    stop() {
      if (state.queued.length) set({ queued: [] });
      denyPending();
      controller?.abort();
      settleIdle();
    },
    approve(id, decision) {
      const resolve = waiting.get(id);
      if (!resolve) return false;
      waiting.delete(id);
      set({ approvals: state.approvals.filter((request) => request.id !== id) });
      resolve(decision);
      return true;
    },
    setAgent(next) {
      if (next === agent) return;
      agent = next;
      set({ agent: next.name, sessionId: undefined });
    },
    setModel(model) {
      set({ model });
    },
    reset() {
      set({ sessionId: undefined });
    },
    idle() {
      if (state.status === 'idle' && !state.queued.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    close() {
      closed = true;
      this.stop();
      listeners.clear();
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

function addUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  const next: TokenUsage = {};
  const inputTokens = sum(total.inputTokens, usage.inputTokens);
  const outputTokens = sum(total.outputTokens, usage.outputTokens);
  const cachedInputTokens = sum(total.cachedInputTokens, usage.cachedInputTokens);
  const totalTokens = sum(total.totalTokens, usage.totalTokens);
  if (inputTokens !== undefined) next.inputTokens = inputTokens;
  if (outputTokens !== undefined) next.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) next.cachedInputTokens = cachedInputTokens;
  if (totalTokens !== undefined) next.totalTokens = totalTokens;
  return next;
}
