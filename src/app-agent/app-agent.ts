import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectAgents } from '../agents/discovery.js';
import { createAgentSession, type AgentSession, type SessionState } from '../agents/session.js';
import type { CodingAgent } from '../agents/types.js';
import { commitTree, snapshotTree, treeChanges, type TreeChanges } from './git.js';
import type { McpTool } from './mcp.js';
import { defaultAppAgents, type AppAgentMode } from './policy.js';

/**
 * A tool the app gives its agent. Read tools run when the agent calls them. Write tools
 * (`write: true`) only create an action: the user approves or rejects it in the app, and the
 * agent hears the outcome as its next message.
 */
export interface AppTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. Default: no arguments. */
  inputSchema?: Record<string, unknown>;
  write?: boolean;
  /** Throw to refuse a call. Write tools check here, before an action is created. */
  validate?(args: Record<string, unknown>): void;
  /** What the tool returns to the agent (read tools) or the outcome of an approved action (write tools). */
  run(args: Record<string, unknown>): Promise<string> | string;
}

export type AppActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'rejected';

/** A write waiting for the user, or done. */
export interface AppAction {
  id: string;
  kind: 'tool' | 'commit';
  /** The one line the user reads before deciding. */
  summary: string;
  tool?: { name: string; args: Record<string, unknown> };
  commit?: { message: string; tree: string };
  status: AppActionStatus;
  result?: string;
  createdAt: number;
}

/** A chip the agent offers under a reply; clicking it opens that page of the app. */
export interface AppLink {
  turnId: number;
  label: string;
  path: string;
}

export interface AppAgentState {
  name: string;
  mode: AppAgentMode;
  /** `dev` is offered only when the app configured it. */
  modes: AppAgentMode[];
  agent: string;
  agents: Array<{ name: string; installed: boolean }>;
  session: SessionState | null;
  actions: AppAction[];
  links: AppLink[];
  /** The page the app last reported as open. */
  view: string | null;
  /** A bumped id asks the page to open `path` once. */
  navigation: { id: number; path: string } | null;
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
    /** Commands the agent may run there, e.g. `npm test`. Read-only git is always allowed. */
    commands?: readonly string[];
    instructions?: string;
  };
  /** Agents offered in each mode. Default `defaultAppAgents(mode, dev.commands)`. */
  agents?: (mode: AppAgentMode) => readonly CodingAgent[];
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  /** Where the agent reaches the app's MCP endpoint (`<basePath>/mcp` of the handler). */
  mcpUrl: string | (() => string);
  /** Bearer the agent sends to the MCP endpoint. Default: 24 random bytes. */
  mcpToken?: string;
  /** MCP server name the agent sees; its tools show as `mcp__<name>__<tool>`. Default `app`. */
  serverName?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export interface AppAgent {
  get(): AppAgentState;
  subscribe(listener: (state: AppAgentState) => void): () => void;
  /** A message from the user. Carries the open page when the app reports one. */
  send(text: string): void;
  stop(): void;
  /** Drop the conversation; the next message starts fresh. */
  reset(): void;
  /** Switch agent or mode between turns. Throws while a turn runs. */
  configure(change: { agent?: string; mode?: AppAgentMode }): void;
  /** The app reports which page is open. */
  setView(path: string): void;
  decide(id: string, decision: 'approve' | 'reject'): void;
  /** The diff a proposed commit would land. */
  changes(id: string): Promise<TreeChanges>;
  /** The tools the agent currently sees over MCP. */
  mcpTools(): McpTool[];
  /** Bearer the agent sends to the MCP endpoint. */
  readonly mcpToken: string;
  readonly serverName: string;
  close(): void;
}

/** Separates the briefing and page context from what the user typed. */
export const PROMPT_MARKER = '\n\nUser message:\n';

/** What the user typed, without the briefing or page context in front of it. */
export function userText(prompt: string): string {
  const at = prompt.lastIndexOf(PROMPT_MARKER);
  return at < 0 ? prompt : prompt.slice(at + PROMPT_MARKER.length);
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

/**
 * A coding agent inside a local app: the user chats with an agent CLI from their machine
 * (Claude Code, Codex, Copilot...), the agent uses the app through tools the app serves over
 * MCP, writes wait for the user's approval, and in `dev` mode the agent also changes the
 * app's code and proposes a commit of exactly the reviewed tree.
 *
 * This is the state and logic only; `createAppAgentHandler` serves it over HTTP.
 */
export function createAppAgent(options: AppAgentOptions): AppAgent {
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const serverName = options.serverName ?? 'app';
  const mcpToken = options.mcpToken ?? randomBytes(24).toString('base64url');
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
  const listeners = new Set<(state: AppAgentState) => void>();

  const get = (): AppAgentState => ({
    name: options.name,
    mode,
    modes,
    agent: agentName,
    agents: installed(mode),
    session: session?.get() ?? null,
    actions,
    links,
    view,
    navigation,
  });
  const changed = () => {
    const state = get();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Keep other subscribers going.
      }
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
    return session;
  };

  const dropSession = () => {
    links = [];
    unsubscribeSession?.();
    session?.close();
    session = null;
    unsubscribeSession = null;
    briefed = false;
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
        ...(commands.length ? [`You may run: ${commands.join(', ')}, and read-only git.`] : []),
        'Do not commit or push. When the change is ready, call `propose_commit` with a commit message;',
        'the user reviews the diff and approves it.',
        ...(options.dev.instructions ? [options.dev.instructions] : []),
      );
    }
    const extra = typeof options.instructions === 'function' ? options.instructions(mode) : options.instructions;
    if (extra) lines.push('', extra);
    return lines.join('\n');
  };

  const deliver = (text: string, withView: boolean) => {
    const target = ensureSession();
    const seen = withView && view ? `[The user has ${view} open]` : '';
    if (!briefed) {
      briefed = true;
      target.send(`${briefing()}${seen ? `\n\n${seen}` : ''}${PROMPT_MARKER}${text}`);
    } else {
      target.send(seen ? `${seen}${PROMPT_MARKER}${text}` : text);
    }
  };

  // App notes reach an agent that is already talking; they never start a conversation.
  const tell = (text: string) => {
    if (session) deliver(`[app] ${text}`, false);
  };

  const updateAction = (id: string, patch: Partial<AppAction>) => {
    actions = actions.map((action) => (action.id === id ? { ...action, ...patch } : action));
    changed();
  };

  const propose = (action: Omit<AppAction, 'id' | 'status' | 'createdAt'>): AppAction => {
    const created: AppAction = { ...action, id: String(nextAction++), status: 'pending', createdAt: now() };
    actions = [...actions, created].slice(-MAX_ACTIONS);
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
            summary: { type: 'string', description: 'One line the user reads before approving' },
          },
          required: [...required.filter((name) => name !== 'summary'), 'summary'],
        },
        call: async (args) => {
          const { summary, ...rest } = args;
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
        navigation = { id: (navigation?.id ?? 0) + 1, path: target };
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
        const tree = await snapshotTree(repo());
        return waiting(propose({ kind: 'commit', summary: message.split('\n')[0]!, commit: { message, tree } }));
      },
    },
  ];

  const repo = () => options.dev?.repo ?? options.dev!.cwd;

  const execute = async (action: AppAction) => {
    updateAction(action.id, { status: 'running' });
    try {
      if (action.kind === 'commit') {
        // No edits may land between the check and the commit.
        session?.stop();
        const outcome = await commitTree(repo(), action.commit!.tree, action.commit!.message);
        updateAction(action.id, { status: outcome.ok ? 'done' : 'failed', result: outcome.output });
        tell(`Commit #${action.id} ${outcome.ok ? 'succeeded' : 'failed'}:\n${outcome.output}`);
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
    }
  };

  return {
    mcpToken,
    serverName,
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(text) {
      const trimmed = text.trim();
      if (!trimmed) throw new AppAgentError('empty message', 400);
      deliver(trimmed, true);
    },
    stop() {
      session?.stop();
    },
    reset() {
      dropSession();
      changed();
    },
    configure(change) {
      const nextMode = change.mode ?? mode;
      if (!modes.includes(nextMode)) throw new AppAgentError(`unknown mode "${nextMode}"`, 400);
      const nextAgent = change.agent ?? agentName;
      if (!agentsFor(nextMode).some((agent) => agent.name === nextAgent)) {
        throw new AppAgentError(`unknown agent "${nextAgent}"`, 400);
      }
      if (session?.get().status === 'running') throw new AppAgentError('the agent is busy', 409);
      mode = nextMode;
      agentName = nextAgent;
      dropSession();
      changed();
    },
    setView(next) {
      view = next;
    },
    decide(id, decision) {
      const action = actions.find((candidate) => candidate.id === id);
      if (!action) throw new AppAgentError('no such action', 404);
      if (action.status !== 'pending') throw new AppAgentError(`action is ${action.status}`, 409);
      if (decision === 'reject') {
        updateAction(id, { status: 'rejected' });
        tell(`The user rejected action #${id} (${action.summary}).`);
      } else {
        void execute(action);
      }
    },
    async changes(id) {
      const action = actions.find((candidate) => candidate.id === id);
      if (!action?.commit) throw new AppAgentError('no such commit action', 404);
      return treeChanges(repo(), action.commit.tree);
    },
    mcpTools() {
      return [...appTools(), ...(options.pages ? pageTools() : []), ...(mode === 'dev' ? devTools() : [])];
    },
    close() {
      listeners.clear();
      dropSession();
    },
  };
}
