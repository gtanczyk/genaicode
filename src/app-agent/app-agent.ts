import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { detectAgents } from '../agents/discovery.js';
import { createAgentSession, type AgentSession, type SessionTurn } from '../agents/session.js';
import type { ApprovalDecision, CodingAgent } from '../agents/types.js';
import { commitTree, snapshotTree, treeChanges } from './git.js';
import type { McpTool } from './mcp.js';
import { defaultAppAgents } from './policy.js';
import {
  APP_NOTE,
  PROMPT_MARKER,
  userText,
  type AppAction,
  type AppLink,
  type AppAgentMode,
  type AppAgentState,
  type TreeChanges,
} from './state.js';

/**
 * A tool the app gives its agent. Read tools run when the agent calls them. Write tools
 * (`write: true`) only create an action: the user approves or rejects it in the app, and the
 * agent hears the outcome as its next message.
 */
const APPROVAL_SUMMARY = 'approval_summary';

export interface AppTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. Default: no arguments. */
  inputSchema?: Record<string, unknown>;
  /** Needs the user's approval. The agent also passes `approval_summary`, which `run` never sees. */
  write?: boolean;
  /** Throw to refuse a call. Write tools check here, before an action is created. */
  validate?(args: Record<string, unknown>): void;
  /** What the tool returns to the agent (read tools) or the outcome of an approved action (write tools). */
  run(args: Record<string, unknown>): Promise<string> | string;
}

export interface AppAgentOptions {
  /** How the agent should call the app, e.g. "the gamedev.pl operator console". */
  name: string;
  /** Added to the briefing the first prompt carries. */
  instructions?: string | ((mode: AppAgentMode) => string);
  tools?: readonly AppTool[];
  /** Paths of the app's pages. Turns on page context and the `app_view`, `app_links` and `app_open` tools. */
  pages?: () => readonly string[];
  /** Turns on `dev` mode: the agent edits the app's code in `cwd` and proposes a commit. */
  dev?: {
    cwd: string;
    /** Git repository the commit goes to. Default `cwd`. */
    repo?: string;
    /**
     * Commands the agent may run there, each with any arguments, e.g. `npm test`; anything
     * else, git included, goes through the agent CLI's own permission prompt.
     * Claude and Copilot enforce the list; Codex only has its `workspace-write` sandbox.
     */
    commands?: readonly string[];
    instructions?: string;
  };
  /** Agents offered in each mode. Default `defaultAppAgents(mode, dev.commands)`. */
  agents?: (mode: AppAgentMode) => readonly CodingAgent[];
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  /** Where the agent reaches the app's MCP endpoint (`<basePath>/mcp` of the handler). */
  mcpUrl: string | (() => string);
  /** MCP server name the agent sees; its tools show as `mcp__<name>__<tool>`. Default `app`. */
  serverName?: string;
  env?: NodeJS.ProcessEnv;
  /** Every prompt, tool call, decision and finished turn, e.g. to append to a JSONL log. */
  trace?: (record: AppAgentTrace) => void;
  now?: () => number;
}

/** One line of the trace. Long texts are clipped. */
export type AppAgentTrace =
  | { kind: 'session'; agent: string; mode: AppAgentMode }
  | { kind: 'prompt'; agent: string; mode: AppAgentMode; view: string | null; text: string }
  | { kind: 'note'; text: string }
  | {
      kind: 'mcp';
      tool: string;
      args: Record<string, unknown>;
      ok: boolean;
      ms: number;
      result?: string;
      error?: string;
    }
  | { kind: 'decision'; action: string; summary: string; decision: 'approve' | 'reject' }
  | {
      kind: 'turn';
      agent: string;
      mode: AppAgentMode;
      turn: number;
      status: string;
      ok: boolean;
      error?: string;
      ms: number;
      costUsd?: number;
      entries: unknown[];
    };

export interface AppAgent {
  get(): AppAgentState;
  subscribe(listener: (state: AppAgentState) => void): () => void;
  /** A message from the user. Carries the open page when the app reports one. */
  send(text: string): void;
  stop(): void;
  /** Drop the conversation, history and chips; the next message starts fresh. */
  reset(): void;
  /**
   * Switch agent or mode between turns. Throws while a turn runs. The transcript so far moves
   * to `history`, and the next agent's first prompt carries a short version of it.
   */
  configure(change: { agent?: string; mode?: AppAgentMode }): void;
  /** The app reports which page is open. */
  setView(path: string): void;
  decide(id: string, decision: 'approve' | 'reject'): void;
  /** Answer a permission prompt of the agent CLI itself (`session.approvals`). */
  approve(id: string, decision: ApprovalDecision): void;
  /** The diff a proposed commit would land. */
  changes(id: string): Promise<TreeChanges>;
  /** The tools the agent currently sees over MCP. */
  mcpTools(): McpTool[];
  /** Bearer the current session's agent sends to the MCP endpoint; a new one with every session. */
  readonly mcpToken: string;
  readonly serverName: string;
  close(): void;
}

export class AppAgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_ACTIONS = 50;
const MAX_LINKS = 6;
const MAX_HISTORY = 100;
const CARRY_MAX = 12_000;
const STOP_WAIT_MS = 10_000;

/**
 * A coding agent inside a local app: the user chats with an agent CLI from their machine
 * (Claude Code, Codex, Copilot...), the agent uses the app through tools the app serves over
 * MCP, writes wait for the user's approval, and in `dev` mode the agent also changes the
 * app's code and proposes a commit of exactly the reviewed tree.
 *
 * This is the state and logic only; `createAppAgentHandler` serves it over HTTP.
 */
export function createAppAgent(options: AppAgentOptions): AppAgent {
  const names = new Set(['app_view', 'app_links', 'app_open', 'propose_commit']);
  for (const tool of options.tools ?? []) {
    if (names.has(tool.name)) throw new Error(`tool name "${tool.name}" is taken`);
    names.add(tool.name);
    const properties = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
    if (tool.write && APPROVAL_SUMMARY in properties) {
      throw new Error(`write tool "${tool.name}" cannot take an argument named ${APPROVAL_SUMMARY}`);
    }
  }
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const serverName = options.serverName ?? 'app';
  // A dropped session's process may still be winding down: its late calls must not reach the app.
  const newToken = () => randomBytes(24).toString('base64url');
  let mcpToken = newToken();
  const modes: AppAgentMode[] = options.dev ? ['use', 'dev'] : ['use'];
  const agentsFor = (target: AppAgentMode) =>
    options.agents?.(target) ?? defaultAppAgents(target, options.dev?.commands ?? []);
  // PATH lookups once per mode, not on every streamed update.
  const found = new Map<AppAgentMode, AppAgentState['agents']>();
  const installed = (target: AppAgentMode) => {
    let list = found.get(target);
    if (!list) {
      list = detectAgents(agentsFor(target), env).map(({ agent, path: where }) => ({
        name: agent.name,
        installed: where !== null,
      }));
      found.set(target, list);
    }
    return list;
  };

  let mode: AppAgentMode = 'use';
  const startList = installed(mode);
  let agentName = options.agent ?? startList.find((choice) => choice.installed)?.name ?? startList[0]?.name ?? 'claude';
  if (!startList.some((choice) => choice.name === agentName)) {
    throw new AppAgentError(`Unknown agent "${agentName}".`, 400);
  }
  let session: AgentSession | null = null;
  let unsubscribeSession: (() => void) | null = null;
  let briefed = false;
  let useCwd: string | null = null;
  let actions: AppAction[] = [];
  let nextAction = 1;
  let view: string | null = null;
  let links: AppLink[] = [];
  let navigation: AppAgentState['navigation'] = null;
  let history: SessionTurn[] = [];
  let nextArchivedId = -1;
  let carryOver = '';
  // The user's prompts sent while an action runs: they follow its outcome, never overtake it.
  let held: string[] = [];
  let traced = new Set<number>();
  // Logging only observes: a failing sink must not change what happens (an action's status).
  const trace = (record: Parameters<NonNullable<AppAgentOptions['trace']>>[0]) => {
    try {
      options.trace?.(record);
    } catch {
      // dropped
    }
  };
  const listeners = new Set<(state: AppAgentState) => void>();

  const get = (): AppAgentState => ({
    name: options.name,
    mode,
    modes,
    agent: agentName,
    agents: installed(mode),
    session:
      session && held.length
        ? { ...session.get(), queued: [...session.get().queued, ...held] }
        : (session?.get() ?? null),
    history,
    actions,
    links,
    view,
    navigation,
  });
  const changed = () => {
    traceTurns();
    const state = get();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Keep other subscribers going.
      }
    }
  };

  const traceTurns = () => {
    if (!options.trace) return;
    for (const turn of session?.get().turns ?? []) {
      if (!turn.result || traced.has(turn.id)) continue;
      const record: AppAgentTrace = {
        kind: 'turn',
        agent: turn.agent,
        mode,
        turn: turn.id,
        status: turn.result.status,
        ok: turn.result.ok,
        ...(turn.result.error ? { error: turn.result.error } : {}),
        ms: (turn.endedAt ?? now()) - turn.startedAt,
        ...(turn.costUsd !== undefined ? { costUsd: turn.costUsd } : {}),
        entries: turn.entries.map((entry) =>
          entry.kind === 'tool'
            ? {
                ...entry,
                input: clip(jsonText(entry.input), 1_000),
                output: clip(entry.output ?? '', 2_000),
              }
            : entry.kind === 'text'
              ? { ...entry, text: clip(entry.text, 4_000) }
              : entry,
        ),
      };
      traced.add(turn.id);
      trace(record);
    }
  };

  const cwdFor = (target: AppAgentMode) => {
    if (target === 'dev') return options.dev!.cwd;
    // No files to touch in use mode: an empty directory keeps the agent on the app's tools.
    useCwd ??= mkdtempSync(path.join(tmpdir(), 'genaicode-app-agent-'));
    return useCwd;
  };

  const ensureSession = (): AgentSession => {
    if (session) return session;
    const agent = agentsFor(mode).find((candidate) => candidate.name === agentName);
    if (!agent) throw new AppAgentError(`Agent "${agentName}" is not offered in ${mode} mode.`, 400);
    const url = typeof options.mcpUrl === 'function' ? options.mcpUrl() : options.mcpUrl;
    session = createAgentSession({
      agent,
      cwd: cwdFor(mode),
      task: {
        env,
        mcpServers: [{ name: serverName, url, headers: { authorization: `Bearer ${mcpToken}` } }],
      },
    });
    unsubscribeSession = session.subscribe(changed);
    briefed = false;
    traced = new Set();
    trace({ kind: 'session', agent: agentName, mode });
    return session;
  };

  // The turns so far stay in the conversation; negative ids keep their chips attached.
  const archiveSession = () => {
    const turns = session?.get().turns ?? [];
    if (turns.length === 0) return;
    const ids = new Map(turns.map((turn) => [turn.id, nextArchivedId--]));
    history = [...history, ...turns.map((turn) => ({ ...turn, id: ids.get(turn.id)! }))].slice(-MAX_HISTORY);
    links = links.flatMap((link) => {
      if (link.turnId < 0) return [link];
      const id = ids.get(link.turnId);
      return id === undefined ? [] : [{ ...link, turnId: id }];
    });
    carryOver = clip(`${carryOver}\n\n${transcript(turns)}`.trim(), CARRY_MAX, true);
  };

  // Notes the old session still held (the user stopped its turn) go to the next agent.
  const archiveNotes = () => {
    for (const note of session?.get().notes ?? []) {
      carryOver = clip(`${carryOver}\n\n${userText(note)}`.trim(), CARRY_MAX, true);
    }
  };

  const dropSession = () => {
    traceTurns();
    links = links.filter((link) => link.turnId < 0);
    unsubscribeSession?.();
    session?.close();
    session = null;
    unsubscribeSession = null;
    briefed = false;
    mcpToken = newToken();
  };

  const briefing = (): string => {
    const tool = (name: string) => `\`${name}\``;
    const lines = [
      `You are the assistant inside ${options.name}, a local app on the user's machine.`,
      `Use the \`${serverName}\` MCP tools to read from and act in the app.`,
      'Tools that make changes do not run at once: the user approves or rejects each one in the app,',
      'and you get a message with the outcome. Never say a change happened before that message.',
      'Answer in the language the user writes in. Be brief and lead with the answer.',
    ];
    if (options.pages) {
      lines.push(
        `Prompts start with the page the user has open; ${tool('app_view')} reads it again.`,
        `When a page of the app shows what you mean, offer it with ${tool('app_links')} chips.`,
        'Chips appear under your reply on their own; do not point at them.',
        `Call ${tool('app_open')} only when the user asks you to take them somewhere.`,
      );
    }
    if (mode === 'dev' && options.dev) {
      const commands = options.dev.commands ?? [];
      lines.push(
        '',
        `Dev mode: your cwd is ${options.dev.cwd}; you may change the app's own code there.`,
        ...(commands.length ? [`You may run: ${commands.join(', ')}.`] : []),
        'Do not commit or push. When the change is ready, call `propose_commit` with a commit message;',
        'the user reviews the diff and approves it.',
        ...(options.dev.instructions ? [options.dev.instructions] : []),
      );
    }
    const extra = typeof options.instructions === 'function' ? options.instructions(mode) : options.instructions;
    if (extra) lines.push('', extra);
    return lines.join('\n');
  };

  // App notes go ahead of queued prompts and survive a stop: an action's outcome is the agent's
  // next message.
  const deliver = (text: string, withView: boolean, note = false) => {
    const target = ensureSession();
    const seen = withView && view ? `[The user has ${view} open]` : '';
    if (!briefed) {
      briefed = true;
      const earlier = carryOver ? `\n\nEarlier in this conversation, with another agent or mode:\n${carryOver}` : '';
      target.send(`${briefing()}${earlier}${seen ? `\n\n${seen}` : ''}${PROMPT_MARKER}${text}`, { note });
    } else {
      target.send(seen ? `${seen}${PROMPT_MARKER}${text}` : text, { note });
    }
  };

  // App notes reach an agent that is already talking; they never start a conversation.
  const tell = (text: string) => {
    if (!session) {
      // The conversation moved to another agent or mode: the next one hears it in its briefing.
      if (carryOver) carryOver = clip(`${carryOver}\n\n${APP_NOTE}${text}`, CARRY_MAX, true);
      return;
    }
    trace({ kind: 'note', text: clip(text, 2_000) });
    deliver(`${APP_NOTE}${text}`, false, true);
  };

  const updateAction = (id: string, patch: Partial<AppAction>) => {
    actions = actions.map((action) => (action.id === id ? { ...action, ...patch } : action));
    changed();
  };

  const propose = (action: Omit<AppAction, 'id' | 'status' | 'createdAt'>): AppAction => {
    const open = actions.filter((candidate) => candidate.status === 'pending' || candidate.status === 'running');
    if (open.length >= MAX_ACTIONS) {
      throw new Error(`${open.length} actions already wait for the user; wait for their decisions first`);
    }
    const created: AppAction = { ...action, id: String(nextAction++), status: 'pending', createdAt: now() };
    actions = [...actions, created];
    // Only settled actions make room: a pending one still waits for the user.
    while (actions.length > MAX_ACTIONS) {
      const settled = actions.findIndex(
        (candidate) => candidate.status !== 'pending' && candidate.status !== 'running',
      );
      if (settled < 0) break;
      actions = actions.filter((_, index) => index !== settled);
    }
    changed();
    return created;
  };

  const knownPage = (value: unknown): string => {
    const target = String(value ?? '');
    const pages = options.pages?.() ?? [];
    if (!pages.includes(target)) throw new Error(`unknown page "${target}"; known: ${pages.join(', ')}`);
    return target;
  };

  const waiting = (action: AppAction) =>
    `Waiting for the user as action #${action.id}. You will get a message with the outcome.`;

  const appTools = (): McpTool[] =>
    (options.tools ?? []).map((tool) => {
      const schema = tool.inputSchema ?? { type: 'object', properties: {} };
      if (!tool.write) {
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: schema,
          call: async (args) => {
            tool.validate?.(args);
            return await tool.run(args);
          },
        };
      }
      const properties = (schema.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      return {
        name: tool.name,
        description: `${tool.description} Runs only after the user approves it.`,
        inputSchema: {
          ...schema,
          type: 'object',
          properties: {
            ...properties,
            [APPROVAL_SUMMARY]: { type: 'string', description: 'One line the user reads before approving' },
          },
          required: [...required, APPROVAL_SUMMARY],
        },
        call: async (args) => {
          const { [APPROVAL_SUMMARY]: summary, ...rest } = args;
          tool.validate?.(rest);
          const action = propose({
            kind: 'tool',
            summary: String(summary ?? '').trim() || tool.name,
            tool: { name: tool.name, args: rest },
          });
          return waiting(action);
        },
      };
    });

  const pageTools = (): McpTool[] => [
    {
      name: 'app_view',
      description: 'The page the user has open in the app now, and the pages they can open.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => `Open: ${view ?? 'unknown'}\nPages: ${(options.pages?.() ?? []).join(', ')}`,
    },
    {
      name: 'app_links',
      description: 'Offer the user clickable chips under your answer, each opening a page of the app.',
      inputSchema: {
        type: 'object',
        properties: {
          links: {
            type: 'array',
            maxItems: MAX_LINKS,
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, path: { type: 'string' } },
              required: ['label', 'path'],
            },
          },
        },
        required: ['links'],
      },
      call: async (args) => {
        const turnId = session?.get().turns.at(-1)?.id;
        if (!turnId) throw new Error('no turn to attach links to');
        const offered = (Array.isArray(args.links) ? args.links : []).slice(0, MAX_LINKS).map((link) => {
          const { label, path: target } = (link ?? {}) as { label?: unknown; path?: unknown };
          const page = knownPage(target);
          return { turnId, label: String(label ?? '').slice(0, 60) || page, path: page };
        });
        links = [...links, ...offered].slice(-30);
        changed();
        return `Showing ${offered.length} chip(s).`;
      },
    },
    {
      name: 'app_open',
      description: 'Open a page of the app for the user. Use only when they ask to go there.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      call: async (args) => {
        const target = knownPage(args.path);
        // Time-based: a restarted or another backend never reuses an id the page already followed.
        navigation = { id: Math.max(now(), (navigation?.id ?? 0) + 1), path: target };
        changed();
        return `Opened ${target}.`;
      },
    },
  ];

  const devTools = (): McpTool[] => [
    {
      name: 'propose_commit',
      description: 'Ask the user to commit all current changes in the repository with this message.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Commit message: subject line, blank line, body' } },
        required: ['message'],
      },
      call: async (args) => {
        const message = String(args.message ?? '').trim();
        if (!message) throw new Error('message is required');
        const token = mcpToken;
        const snapshot = await snapshotTree(repo());
        // A reset or agent switch meanwhile: this call belongs to a session that is gone.
        if (token !== mcpToken) throw new Error('This session has ended.');
        return waiting(propose({ kind: 'commit', summary: message.split('\n')[0]!, commit: { message, ...snapshot } }));
      },
    },
  ];

  const repo = () => options.dev?.repo ?? options.dev!.cwd;

  const execute = async (action: AppAction) => {
    updateAction(action.id, { status: 'running' });
    try {
      if (action.kind === 'commit') {
        // No edits may land between the check and the commit. Stopping drops the queue: keep it.
        const stopped = session;
        const queued = stopped?.get().queued ?? [];
        stopped?.stop();
        try {
          // Let the stopped run wind down: none of its edits may land after the check.
          if (stopped) await Promise.race([stopped.idle(), delay(STOP_WAIT_MS, undefined, { ref: false })]);
          // A throw is this action's outcome too: it must reach the agent before the queued prompts.
          const outcome = await commitTree(repo(), action.commit!, action.commit!.message).catch((error: Error) => ({
            ok: false,
            output: error.message,
          }));
          updateAction(action.id, { status: outcome.ok ? 'done' : 'failed', result: outcome.output });
          // A note sent while the stopped run still winds down would wait for the user's next
          // prompt; send it once the session is idle, so it starts its own turn.
          if (stopped && session === stopped) await stopped.idle();
          tell(`Commit #${action.id} ${outcome.ok ? 'succeeded' : 'failed'}:\n${outcome.output}`);
        } finally {
          if (session === stopped) for (const prompt of queued) session?.send(prompt);
        }
      } else {
        const tool = options.tools?.find((candidate) => candidate.name === action.tool!.name);
        if (!tool) throw new Error(`tool ${action.tool!.name} is gone`);
        const output = await tool.run(action.tool!.args);
        updateAction(action.id, { status: 'done', result: output });
        tell(`The user approved action #${action.id} (${action.summary}). Result:\n${output}`);
      }
    } catch (error) {
      updateAction(action.id, { status: 'failed', result: (error as Error).message });
      tell(`Action #${action.id} failed: ${(error as Error).message}`);
    } finally {
      if (!actions.some((candidate) => candidate.status === 'running')) {
        const release = held;
        held = [];
        for (const prompt of release) deliver(prompt, true);
      }
    }
  };

  return {
    get mcpToken() {
      return mcpToken;
    },
    serverName,
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(text) {
      const trimmed = text.trim();
      if (!trimmed) throw new AppAgentError('empty message', 400);
      trace({ kind: 'prompt', agent: agentName, mode, view, text: clip(trimmed, 4_000) });
      if (actions.some((action) => action.status === 'running')) {
        held = [...held, trimmed];
        changed();
        return;
      }
      deliver(trimmed, true);
    },
    stop() {
      session?.stop();
    },
    reset() {
      if (actions.some((action) => action.status === 'running')) throw new AppAgentError('an action is running', 409);
      dropSession();
      history = [];
      links = [];
      carryOver = '';
      // A fresh conversation cannot hear their outcome: nothing waits for the user any more.
      actions = actions.map((action) =>
        action.status === 'pending' ? { ...action, status: 'rejected', result: 'Dropped by starting over.' } : action,
      );
      changed();
    },
    configure(change) {
      const nextMode = change.mode ?? mode;
      if (!modes.includes(nextMode)) throw new AppAgentError(`unknown mode "${nextMode}"`, 400);
      const offered = installed(nextMode);
      // A mode-only switch keeps the agent when the target mode offers it, else picks one there.
      const nextAgent =
        change.agent ??
        (offered.some((choice) => choice.name === agentName)
          ? agentName
          : (offered.find((choice) => choice.installed)?.name ?? offered[0]?.name ?? agentName));
      if (!agentsFor(nextMode).some((agent) => agent.name === nextAgent)) {
        throw new AppAgentError(`unknown agent "${nextAgent}"`, 400);
      }
      if (session?.get().status === 'running') throw new AppAgentError('the agent is busy', 409);
      if (nextMode === mode && nextAgent === agentName) return;
      // A running action reports to this conversation (and a commit gives back its queue).
      if (actions.some((action) => action.status === 'running')) throw new AppAgentError('an action is running', 409);
      archiveSession();
      archiveNotes();
      mode = nextMode;
      agentName = nextAgent;
      dropSession();
      changed();
    },
    setView(next) {
      if (next === view) return;
      view = next;
      changed();
    },
    decide(id, decision) {
      const action = actions.find((candidate) => candidate.id === id);
      if (!action) throw new AppAgentError('no such action', 404);
      if (action.status !== 'pending') throw new AppAgentError(`action is ${action.status}`, 409);
      trace({ kind: 'decision', action: id, summary: action.summary, decision });
      if (decision === 'reject') {
        updateAction(id, { status: 'rejected' });
        tell(`The user rejected action #${id} (${action.summary}).`);
      } else {
        void execute(action);
      }
    },
    approve(id, decision) {
      if (!session?.approve(id, decision)) throw new AppAgentError('no such approval request', 404);
    },
    async changes(id) {
      const action = actions.find((candidate) => candidate.id === id);
      if (!action?.commit) throw new AppAgentError('no such commit action', 404);
      return treeChanges(repo(), action.commit);
    },
    mcpTools() {
      const tools = [...appTools(), ...(options.pages ? pageTools() : []), ...(mode === 'dev' ? devTools() : [])];
      if (!options.trace) return tools;
      return tools.map((tool) => ({
        ...tool,
        call: async (args: Record<string, unknown>) => {
          const started = now();
          try {
            const result = await tool.call(args);
            trace({ kind: 'mcp', tool: tool.name, args, ok: true, ms: now() - started, result: clip(result, 2_000) });
            return result;
          } catch (error) {
            const message = (error as Error).message;
            trace({ kind: 'mcp', tool: tool.name, args, ok: false, ms: now() - started, error: message });
            throw error;
          }
        },
      }));
    },
    close() {
      listeners.clear();
      dropSession();
      if (useCwd) rmSync(useCwd, { recursive: true, force: true });
      useCwd = null;
    },
  };
}

// A custom agent's tool input can be anything, including a BigInt or a cycle.
function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? String(item) : item)) ?? '';
  } catch {
    return String(value);
  }
}

function clip(text: string, max: number, keepEnd = false): string {
  if (text.length <= max) return text;
  return keepEnd ? `… (earlier part dropped)\n${text.slice(-max)}` : `${text.slice(0, max)}… (clipped)`;
}

// What the user asked and what came back, without the tool calls.
function transcript(turns: readonly SessionTurn[]): string {
  return turns
    .map((turn) => {
      const texts = turn.entries.flatMap((entry) => (entry.kind === 'text' ? [entry.text] : []));
      return `User: ${userText(turn.prompt).trim()}\n${turn.agent}: ${texts.at(-1)?.trim() ?? '(no answer)'}`;
    })
    .join('\n\n');
}
