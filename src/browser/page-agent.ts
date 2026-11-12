import type { SessionEntry, SessionState, SessionTurn } from '../agents/session.js';
import type { AgentEvent, AgentRun, ApprovalDecision, ApprovalRequest, CodingAgent } from '../agents/types.js';
import { addUsage } from '../agents/usage.js';
import type { TokenUsage } from '../core/types.js';
import type { LanguageModelAvailability } from './language-model.js';
import { nano, type NanoAgent, type NanoOptions } from './nano.js';
import type { PageTool } from './tools.js';

export interface PageAgentOptions {
  /** What the assistant is called in the chat. Default `nano`. */
  name?: string;
  /** Who the assistant is and what the page is about. */
  instructions?: string;
  /** What the assistant may do on the page. */
  tools?: readonly PageTool[];
  /** Options for the built-in model driver, when `agent` is not given. */
  nano?: Omit<NanoOptions, 'tools' | 'instructions' | 'name' | 'onDownload'>;
  /**
   * The agent to run instead of `nano()`: anything that implements `CodingAgent` in the browser.
   * It gets no tools from here; give it its own.
   */
  agent?: CodingAgent;
  /**
   * Decide a `write` tool's approval without asking. Return undefined to leave it to the user
   * (`approve()`), which is also what happens without this.
   */
  autoApprove?(request: ApprovalRequest): ApprovalDecision | undefined;
}

/** `checking`: not known yet. `loading`: the model is being read into memory. */
export type PageModelStatus = LanguageModelAvailability | 'checking' | 'loading';

export interface PageAgentState {
  /** The conversation, in the shape `<AgentChat>` draws. */
  session: SessionState;
  model: {
    status: PageModelStatus;
    /** Download progress, 0 to 1, while `status` is `downloading`. */
    progress?: number;
  };
  /** Tokens in use and the size of the model's context window, once the model reported them. */
  context?: { used: number; window: number };
}

/** An assistant that lives in the page: the conversation, its state and the calls that drive it. */
export interface PageAgent {
  get(): PageAgentState;
  /** Called with every new state. Returns the function that stops it. */
  subscribe(listener: (state: PageAgentState) => void): () => void;
  /** Send a prompt. While a turn runs it waits in `session.queued`. */
  send(text: string): void;
  /** Stop the running turn and drop queued prompts. */
  stop(): void;
  /** Start a new conversation. */
  reset(): void;
  /** Answer a pending approval (`session.approvals`). False when there is no such request. */
  approve(id: string, decision: ApprovalDecision): boolean;
  /**
   * Load the model now, downloading it first when the browser needs to (several GB, once).
   * Call it from a click: browsers start the download only on a user gesture.
   */
  prepare(): Promise<void>;
  /** Check again whether the browser has the model. */
  refresh(): Promise<PageModelStatus>;
}

/**
 * An assistant for a web page that needs no server: the conversation runs in the page on the
 * browser's built-in model (`nano()`), acts through the `tools` the page gives it and asks the
 * user before a `write` tool runs. Draw it with `<PageAgentChat>` from `genaicode/react`, or
 * read `get()`/`subscribe()` from any UI.
 */
export function createPageAgent(options: PageAgentOptions = {}): PageAgent {
  const listeners = new Set<(state: PageAgentState) => void>();
  const waiting = new Map<string, (decision: ApprovalDecision) => void>();
  let nextTurn = 1;
  let run: AgentRun | undefined;
  // The driver's conversation; not in `session`, where the chat would show it as a chip.
  let conversation: string | undefined;
  // Usage of the finished turns; a running turn reports its own total so far.
  let pastUsage: TokenUsage = {};
  // A reset or stop makes the events of the run before it stale.
  let generation = 0;

  const builtIn: NanoAgent | undefined = options.agent
    ? undefined
    : nano({
        ...options.nano,
        name: options.name ?? 'nano',
        instructions: options.instructions,
        tools: options.tools,
        onDownload: (progress) => setModel({ status: progress >= 1 ? 'loading' : 'downloading', progress }),
      });
  const agent: CodingAgent = options.agent ?? builtIn!;

  let state: PageAgentState = {
    session: {
      agent: agent.name,
      cwd: '',
      status: 'idle',
      turns: [],
      queued: [],
      approvals: [],
      usage: {},
      canSteer: false,
    },
    model: { status: builtIn ? 'checking' : 'available' },
  };

  const publish = (next: PageAgentState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };
  const setSession = (change: Partial<SessionState>) => publish({ ...state, session: { ...state.session, ...change } });
  const setModel = (model: PageAgentState['model']) => {
    if (model.status === state.model.status && model.progress === state.model.progress) return;
    publish({ ...state, model });
  };
  const updateTurn = (id: number, change: (turn: SessionTurn) => SessionTurn) =>
    setSession({ turns: state.session.turns.map((turn) => (turn.id === id ? change(turn) : turn)) });
  const addEntry = (id: number, entry: SessionEntry) =>
    updateTurn(id, (turn) => ({ ...turn, entries: [...turn.entries, entry] }));

  const refresh = async (settled = false): Promise<PageModelStatus> => {
    if (!builtIn) return 'available';
    const status = await builtIn.availability();
    // A download or a load in progress knows better than a fresh `downloadable`.
    const busy = !settled && (state.model.status === 'downloading' || state.model.status === 'loading');
    if (!busy || status === 'available' || status === 'unavailable') setModel({ status });
    return state.model.status;
  };
  void refresh();

  function apply(turnId: number, event: AgentEvent): void {
    switch (event.type) {
      case 'session':
        conversation = event.sessionId;
        setSession({ model: event.model });
        if (builtIn) setModel({ status: 'available' });
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
          if (last?.kind === 'text' && last.streaming) {
            return { ...turn, entries: [...turn.entries.slice(0, -1), entry] };
          }
          return { ...turn, entries: [...turn.entries, entry] };
        });
        return;
      case 'tool-start':
        addEntry(turnId, { kind: 'tool', id: event.id, name: event.name, input: event.input, done: false });
        return;
      case 'tool-end':
        updateTurn(turnId, (turn) => ({
          ...turn,
          entries: turn.entries.map((entry) =>
            entry.kind === 'tool' && !entry.done && (event.id === undefined || entry.id === event.id)
              ? { ...entry, output: event.output, isError: event.isError, done: true }
              : entry,
          ),
        }));
        return;
      case 'approval-request':
        addEntry(turnId, { kind: 'approval', request: event.request });
        return;
      case 'approval-resolved':
        updateTurn(turnId, (turn) => ({
          ...turn,
          entries: turn.entries.map((entry) =>
            entry.kind === 'approval' && entry.request.id === event.id
              ? { ...entry, decision: event.decision, automatic: event.automatic }
              : entry,
          ),
        }));
        return;
      case 'usage':
        updateTurn(turnId, (turn) => ({ ...turn, usage: event.usage }));
        setSession({ usage: addUsage(pastUsage, event.usage) });
        return;
      case 'error':
        addEntry(turnId, { kind: 'error', message: event.message });
        return;
      case 'done':
        updateTurn(turnId, (turn) => ({
          ...turn,
          entries: settled(turn.entries),
          endedAt: Date.now(),
          result: event.result,
        }));
        return;
      default:
        return;
    }
  }

  async function start(prompt: string): Promise<void> {
    const mine = ++generation;
    const turnId = nextTurn++;
    const turn: SessionTurn = { id: turnId, agent: agent.name, prompt, entries: [], startedAt: Date.now() };
    setSession({ status: 'running', turns: [...state.session.turns, turn] });
    if (builtIn && state.model.status !== 'available') {
      // The first turn opens the model; a download reports itself through `onDownload`.
      setModel({ status: state.model.status === 'downloadable' ? 'downloading' : 'loading' });
    }
    try {
      // A driver may throw before it returns a run; that ends the turn like any failure.
      const current = agent.run({
        prompt,
        cwd: '',
        resume: conversation,
        onApproval: (request, signal) => ask(request, signal),
      });
      run = current;
      for await (const event of current) {
        if (mine !== generation) continue;
        apply(turnId, event);
        const context = builtIn && conversation ? builtIn.context(conversation) : undefined;
        if (context && (context.used !== state.context?.used || context.window !== state.context?.window)) {
          publish({ ...state, context });
        }
      }
    } catch (error) {
      if (mine === generation) {
        addEntry(turnId, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (mine !== generation) return;
    run = undefined;
    const ended = state.session.turns.find((candidate) => candidate.id === turnId);
    if (ended && !ended.result) {
      // The run ended without a `done` event: close the turn so the chat is not left working.
      const message = 'The agent stopped without a result.';
      updateTurn(turnId, (unfinished) => ({
        ...unfinished,
        entries: settled(unfinished.entries),
        endedAt: Date.now(),
        result: { status: 'failed', ok: false, exitCode: null, signal: null, error: message },
      }));
    }
    pastUsage = state.session.usage;
    if (builtIn && state.model.status !== 'available') void refresh(true);
    const [next, ...queued] = state.session.queued;
    if (next === undefined) {
      setSession({ status: 'idle' });
      return;
    }
    setSession({ queued });
    void start(next);
  }

  function ask(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> {
    const automatic = options.autoApprove?.(request);
    if (automatic) return Promise.resolve(automatic);
    return new Promise((resolve) => {
      const settle = (decision: ApprovalDecision) => {
        if (!waiting.delete(request.id)) return;
        signal?.removeEventListener('abort', withdraw);
        setSession({ approvals: state.session.approvals.filter((pending) => pending.id !== request.id) });
        resolve(decision);
      };
      const withdraw = () => settle('deny');
      waiting.set(request.id, settle);
      setSession({ approvals: [...state.session.approvals, request] });
      if (signal?.aborted) withdraw();
      else signal?.addEventListener('abort', withdraw, { once: true });
    });
  }

  const halt = () => {
    const stopped = run;
    run = undefined;
    for (const settle of [...waiting.values()]) settle('deny');
    stopped?.abort();
    return stopped;
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(text) {
      const prompt = text.trim();
      if (!prompt) return;
      if (state.session.status === 'running') {
        setSession({ queued: [...state.session.queued, prompt] });
        return;
      }
      void start(prompt);
    },
    stop() {
      if (state.session.status !== 'running') return;
      // The run's own `done` event closes the turn; nothing queued follows a stop.
      setSession({ queued: [] });
      run?.abort();
    },
    reset() {
      generation++;
      halt();
      if (conversation) builtIn?.forget(conversation);
      conversation = undefined;
      pastUsage = {};
      publish({
        ...state,
        context: undefined,
        session: {
          ...state.session,
          status: 'idle',
          turns: [],
          queued: [],
          approvals: [],
          usage: {},
        },
      });
    },
    approve(id, decision) {
      const settle = waiting.get(id);
      if (!settle) return false;
      settle(decision);
      return true;
    },
    async prepare() {
      if (!builtIn) return;
      if (state.model.status === 'downloadable') setModel({ status: 'downloading', progress: 0 });
      try {
        await builtIn.prepare();
        setModel({ status: 'available' });
      } catch (error) {
        await refresh(true);
        throw error;
      }
    },
    refresh: () => refresh(),
  };
}

/** The entries of a turn that ended: an open tool or a streaming text would spin forever. */
function settled(entries: SessionEntry[]): SessionEntry[] {
  return entries.map((entry) =>
    entry.kind === 'tool' && !entry.done
      ? { ...entry, done: true, isError: true }
      : entry.kind === 'text' && entry.streaming
        ? { ...entry, streaming: false }
        : entry,
  );
}
