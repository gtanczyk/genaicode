import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { detectAgents } from '../agents/discovery.js';
import type { ArtifactStore } from '../agents/artifacts.js';
import { outputText, type McpTool } from '../agents/mcp-tools.js';
import {
  createAgentSession,
  type AgentSession,
  type AgentSessionOptions,
  type SessionState,
} from '../agents/session.js';
import {
  agentSessionSources,
  archiveKey,
  codexProjects,
  findSession,
  isNeutralHome,
  isSameDir,
  listSessions,
  readConversations,
  readSession,
  readTopics,
  resolveSessionWorkspace,
  resolveTopicWorkspace,
  saveConversation,
  type ConversationOrigin,
  type TopicStore,
} from '../agents/sessions/index.js';
import { isWithin, oneLine } from '../agents/sessions/files.js';
import type { SessionSource } from '../agents/sessions/types.js';
import type { TowerInbox, TowerDecision, TowerView } from '../agents/sessions/tower.js';
import {
  formatSessionUpdate,
  label,
  type SessionSendGate,
  type SessionSendTarget,
  type SessionSendUpdate,
} from '../agents/sessions/send-tool.js';
import type { ChatSessionRelay } from '../react/session-relay.js';
import type {
  AgentBudget,
  AgentTask,
  ApprovalDecision,
  CodingAgent,
  McpServer,
  QuestionAnswers,
} from '../agents/types.js';
import { parseShell, parseSlash, SLASH_COMMANDS } from './format.js';

export interface AgentChoice {
  name: string;
  command: string;
  installed: boolean;
  resume: boolean;
  steer: boolean;
  /** Whether the agent can ask the person to choose (own tool, or `ask_user` over MCP). */
  canAsk?: boolean;
  /** The effort levels it takes, in its own words. Absent: none. */
  effort?: readonly string[];
}

/** A line from the front end itself (agent switched, help...), shown after turn `afterTurn`. */
export interface Notice {
  id: number;
  afterTurn: number;
  text: string;
  tone: 'info' | 'error';
  /** Live card for a message relayed to another session via `sessions_send`. */
  relay?: ChatSessionRelay;
}

/** Metadata of the active conversation in `--home` mode. */
export interface ConversationMeta {
  id: string;
  cwd: string;
  origin: ConversationOrigin;
  title?: string;
  topic?: { id: string; name: string };
}

export interface ChatView {
  session: SessionState;
  notices: Notice[];
  agents: AgentChoice[];
  /** Bark (web) or ring the terminal bell (TUI) when the agent needs you or finishes. */
  bark: boolean;
  /** Every permission request is approved without asking (`--yes`, `/auto`). */
  autoApprove: boolean;
  tower?: TowerView;
  /** `!commands` still running; stop() ends them. */
  shells: number;
  /** Active conversation metadata when running in `--home` mode. */
  conversation?: ConversationMeta;
}

/** Opens the session in the browser from the terminal chat (`/web`). */
export interface WebHandoff {
  /** Start the browser UI on this session, or reuse the running one, and open it. Resolves to its URL. */
  open(): Promise<string>;
  /** Stop the browser UI. Resolves false when it was not running. */
  close(): Promise<boolean>;
}

/** Where a prompt or slash command was typed. */
export type ChatSource = 'terminal' | 'web';

export interface ChatOptions {
  agents: readonly CodingAgent[];
  /**
   * The stores the Sessions view, `/continue` and `--from` read. Default: those of `agents`. Give
   * more when `agents` is narrowed (to the ones that take MCP servers, say).
   */
  sessionSources?: readonly SessionSource[];
  /** Tools explicitly enabled by `--sessions` or `tower`, also used for local previews. */
  sessionTools?: readonly McpTool[];
  /**
   * Backs the agent's `sessions_send` tool (`sessionSendTool`): the first message to each other
   * session shows as an approval, and the answer it got as a line in the chat.
   */
  sessionSend?: SessionSendGate;
  /** Operator inbox shared with the pack's proposal tool in this tower. */
  towerInbox?: TowerInbox;
  /** Show the first five waiting sessions as soon as the tower opens. */
  waitingOnStart?: boolean;
  /** Informational line shown as soon as the chat opens (e.g. auto-selected pack roster). */
  startupNotice?: string;
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  cwd: string;
  model?: string;
  effort?: string;
  resume?: string;
  env?: NodeJS.ProcessEnv;
  /** Approve every permission request without asking. */
  approveAll?: boolean;
  /** Start with the bark on. Default true; `/bark` toggles it. */
  bark?: boolean;
  /** Rewrites each prompt before it reaches the agent; the transcript shows what was typed. */
  transformPrompt?(prompt: string): string;
  /** Backs `/web`. Without it, `/web` only says the browser UI is not available here. */
  web?: WebHandoff;
  task?: Omit<AgentTask, 'prompt' | 'cwd' | 'model' | 'effort' | 'resume' | 'signal' | 'onApproval' | 'env'>;
  /** Caps on the whole session (`AgentSessionOptions.budget`). */
  budget?: AgentBudget;
  /** Let the agent publish artifacts (`genaicode chat` and `ui` do unless `--no-artifacts`). Default true. */
  artifacts?: boolean;
  /** The running artifact channel, started by the front end (`AgentSessionOptions.artifacts`). */
  artifactChannel?: { store: ArtifactStore; mcpServer?: McpServer };
  /** The running `ask_user` channel (`AgentSessionOptions.questions`), started by the front end. */
  questionChannel?: AgentSessionOptions['questions'];
  /** The running `open_project` channel (`AgentSessionOptions.openProject`), started in `--home` mode. */
  openProjectChannel?: AgentSessionOptions['openProject'];
  /** Per-conversation working directory mode (`ui --home`): starts in neutral home, resolves cwd per conversation. */
  home?: boolean;
  /** Opt-in failover: agents (by name) a turn moves to when the current one is out. `/fallback` changes it. */
  fallback?: readonly string[];
}

export interface ChatController {
  get(): ChatView;
  subscribe(listener: (view: ChatView) => void): () => void;
  /** A prompt or a slash command. Returns 'quit' when the user asked to leave. Default source: terminal. */
  submit(text: string, source?: ChatSource): 'ok' | 'quit';
  /** Stop the agent's turn (dropping queued prompts) and the running `!commands`. */
  stop(): void;
  /** Show a line from the front end itself. */
  note(text: string, tone?: Notice['tone']): void;
  approve(id: string, decision: ApprovalDecision): boolean;
  /** Answer a pending question of the agent (`AgentSession.answer`). */
  answer(id: string, answers: QuestionAnswers): boolean;
  decideTower(id: string, decision: TowerDecision): Promise<boolean>;
  /** Switch agents. The conversation is handed over unless `fresh`. */
  selectAgent(name: string, options?: { fresh?: boolean }): boolean;
  setModel(model: string | undefined): void;
  /**
   * Take over the session with this id (any agent's, in this directory or below it, or anywhere
   * in `--home` mode): its turns join the chat and the current agent continues it, resuming when
   * the session is its own and getting a handoff otherwise. Resolves false, with a notice, when it cannot.
   */
  continueSession(id: string): Promise<boolean>;
  /** Start a new conversation in the resolved directory of `topicId` (`--home` mode). */
  startTopicChat(topicId: string): Promise<boolean>;
  /** Start a new conversation back in the neutral home (or current dir in `--cwd` mode). */
  startHomeChat(): boolean;
  /** Move the active conversation into `target.cwd` (used by `open_project` after user confirmation). */
  moveProject(target: { cwd: string; topic?: { id: string; name: string } }): boolean;
  close(): void;
  readonly session: AgentSession;
  /** What the agent published, for the front end that serves it. */
  readonly artifacts?: ArtifactStore;
}

export class NoAgentError extends Error {
  override name = 'NoAgentError';
}

/** Wire an `AgentSession` to the things both front ends share: agent choice, slash commands, notices. */
export function createChatController(options: ChatOptions): ChatController {
  const env = options.env ?? process.env;
  const found = detectAgents(options.agents, env);
  const agents: AgentChoice[] = found.map(({ agent, path }) => ({
    name: agent.name,
    command: agent.command,
    installed: path !== null,
    resume: !!agent.capabilities.resume,
    steer: !!agent.capabilities.steer,
    canAsk:
      !!agent.capabilities.questions ||
      (!!options.questionChannel && !!agent.capabilities.mcp && !agent.capabilities.remote),
    ...(agent.capabilities.effort?.length ? { effort: agent.capabilities.effort } : {}),
  }));
  const byName = new Map(options.agents.map((agent) => [agent.name, agent]));
  let initial: CodingAgent | undefined;
  if (options.agent) {
    initial = byName.get(options.agent);
    if (!initial)
      throw new NoAgentError(`Unknown agent "${options.agent}". Known agents: ${[...byName.keys()].join(', ')}.`);
  } else {
    initial = found.find(({ path }) => path)?.agent;
    if (!initial) {
      throw new NoAgentError(
        `No supported agent CLI found on PATH. Install one of: ${options.agents.map((a) => a.command).join(', ')}.`,
      );
    }
  }

  const fallbackAgents = (names: readonly string[]) => {
    const unknown = names.filter((name) => !byName.has(name));
    if (unknown.length)
      throw new NoAgentError(`Unknown agent "${unknown[0]}". Known agents: ${[...byName.keys()].join(', ')}.`);
    return [...new Set(names)].map((name) => byName.get(name)!);
  };
  let autoApprove = options.approveAll === true;
  let notices: Notice[] = [];
  let conversationEpoch = 0;
  let contextEpoch = 0;
  const relayNotices = new Map<number, number>();
  const relayEpochs = new Map<number, { conversation: number; context: number }>();
  let closed = false;
  const session = createAgentSession({
    ...(options.fallback?.length ? { fallback: fallbackAgents(options.fallback) } : {}),
    agent: initial,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    resume: options.resume,
    task: { ...options.task, env },
    ...(options.budget ? { budget: options.budget } : {}),
    transformPrompt: options.transformPrompt,
    ...(options.artifactChannel ? { artifacts: options.artifactChannel } : {}),
    ...(options.questionChannel ? { questions: options.questionChannel } : {}),
    ...(options.openProjectChannel ? { openProject: options.openProjectChannel } : {}),
    autoApprove: () => (autoApprove ? 'approve' : undefined),
  });
  const homeMode = options.home === true;
  const homeDir = options.cwd;
  let conversation: ConversationMeta | undefined = homeMode
    ? { id: randomUUID(), cwd: homeDir, origin: 'home' }
    : undefined;
  let lastSavedKey = '';
  let nextNotice = 1;
  let bark = options.bark ?? true;
  const inbox = options.towerInbox;
  const shells = new Set<ChildProcess>();
  const syncConversation = (state: SessionState) => {
    if (!homeMode || !conversation) return;
    let next = conversation;
    if (next.cwd !== state.cwd) next = { ...next, cwd: state.cwd };
    if (!next.title && state.turns.length) next = { ...next, title: oneLine(state.turns[0]!.prompt, 120) };
    conversation = next;
    if (!state.turns.length && !state.sessionId && next.origin !== 'project') return;
    const source = byName.get(state.agent)?.sessions?.name;
    const key = JSON.stringify([
      next.id,
      next.cwd,
      next.origin,
      next.title,
      next.topic?.id,
      state.agent,
      state.sessionId,
    ]);
    if (key === lastSavedKey) return;
    lastSavedKey = key;
    void saveConversation(
      {
        id: next.id,
        cwd: next.cwd,
        origin: next.origin,
        ...(next.title ? { title: next.title } : {}),
        ...(next.topic ? { topicId: next.topic.id, topicName: next.topic.name } : {}),
        agent: state.agent,
        ...(source ? { source } : {}),
        ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        updatedAt: Date.now(),
      },
      env,
    ).catch(() => undefined);
  };
  const snapshot = (): ChatView => {
    const state = session.get();
    syncConversation(state);
    return {
      session: state,
      notices,
      agents,
      bark,
      autoApprove,
      shells: shells.size,
      ...(inbox ? { tower: inbox.view(state) } : {}),
      ...(conversation ? { conversation } : {}),
    };
  };
  let view = snapshot();
  let batching = 0;
  const listeners = new Set<(view: ChatView) => void>();
  const publish = () => {
    if (batching > 0) return;
    view = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(view);
      } catch {
        // Keep other subscribers going.
      }
    }
  };
  const unsubscribe = session.subscribe(publish);
  const notice = (text: string, tone: Notice['tone'] = 'info') => {
    if (closed) return;
    notices = [...notices, { id: nextNotice++, afterTurn: session.get().turns.length, text, tone }].slice(-200);
    publish();
  };

  const offInbox = inbox?.subscribe(publish);
  const refreshInbox = () => {
    void inbox?.refresh().catch(() => notice('Could not refresh the tower inbox.', 'error'));
  };
  const inboxTimer = inbox ? setInterval(refreshInbox, 15_000).unref() : undefined;
  if (inbox) refreshInbox();
  // Shell commands started by the operator, e.g. a dev server in this project.
  // Process groups to end on /stop and exit, while anything in them runs: a shell can exit
  // before what it started (`server &`, or on SIGTERM), so a group outlives its shell here
  // until it is empty, or until its SIGKILL once stopped.
  const groups = new Map<ChildProcess, { stopping: boolean }>();
  let sweep: ReturnType<typeof setInterval> | undefined;
  const drop = (child: ChildProcess) => {
    groups.delete(child);
    if (groups.size) return;
    unwatchShells(onEnd);
    clearInterval(sweep);
    sweep = undefined;
  };
  // Forget the groups whose shell exited once nothing runs in them any more.
  const prune = () => {
    for (const [child, group] of groups) {
      if (!shells.has(child) && !group.stopping && !groupAlive(child)) drop(child);
    }
  };
  /** SIGTERM, then SIGKILL for what still runs after a moment; SIGKILL at once when this process ends. */
  const stopShells = (now = false) => {
    prune();
    for (const [child, group] of groups) {
      killTree(child, now ? 'SIGKILL' : 'SIGTERM');
      if (now || group.stopping) continue;
      group.stopping = true;
      setTimeout(() => {
        killTree(child, 'SIGKILL');
        drop(child);
      }, KILL_AFTER_MS).unref();
    }
    return groups.size;
  };
  const stopAll = () => {
    session.stop();
    if (stopShells()) notice('Stopping the shell commands.');
  };
  const onEnd = () => stopShells(true);
  const runShell = (command: string) => {
    if (!command) {
      notice('Type a command after !, e.g. !npm test.', 'error');
      return;
    }
    notice(`$ ${command}`);
    let child: ChildProcess;
    try {
      child = spawn(command, {
        cwd: session.get().cwd,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so /stop also ends what it starts (npm → node).
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      notice(`Could not run it: ${errorText(error)}`, 'error');
      return;
    }
    shells.add(child);
    groups.set(child, { stopping: false });
    watchShells(onEnd);
    publish();
    let output = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Output in batches, so a chatty dev server adds a few notices, not hundreds.
    const flush = () => {
      timer = undefined;
      const lines = output.replace(ANSI, '').replace(/\s+$/, '').split('\n');
      output = '';
      if (lines.length === 1 && !lines[0]) return;
      const shown =
        lines.length > SHELL_LINES
          ? [`… ${lines.length - SHELL_LINES} more lines`, ...lines.slice(-SHELL_LINES)]
          : lines;
      notice(shown.join('\n'));
    };
    const onData = (chunk: string) => {
      output += chunk;
      timer ??= setTimeout(flush, 150);
    };
    // Decoded per stream, so a character split across chunks stays whole.
    child.stdout?.setEncoding('utf8').on('data', onData);
    child.stderr?.setEncoding('utf8').on('data', onData);
    child.on('error', (error) => notice(`Could not run it: ${errorText(error)}`, 'error'));
    child.on('close', (code, signal) => {
      shells.delete(child);
      if (!groups.get(child)?.stopping) {
        if (!groupAlive(child)) drop(child);
        else sweep ??= setInterval(prune, 1000).unref();
      }
      publish();
      if (timer) clearTimeout(timer);
      flush();
      if (signal) notice(`${command}: stopped.`);
      else notice(`${command}: exit code ${code}.`, code ? 'error' : 'info');
    });
    setTimeout(() => {
      if (shells.has(child)) notice(`${command} keeps running here; /stop ends it.`);
    }, 3000).unref?.();
  };

  const selectAgent = (name: string, options?: { fresh?: boolean }): boolean => {
    const agent = byName.get(name);
    if (!agent) {
      notice(`Unknown agent "${name}". Known agents: ${[...byName.keys()].join(', ')}.`, 'error');
      return false;
    }
    if (session.get().status === 'running') {
      notice('Stop the running turn before switching agents.', 'error');
      return false;
    }
    if (agent.name === session.get().agent) {
      if (options?.fresh) {
        contextEpoch += 1;
        session.setAgent(agent, { handoff: false });
        notice(`Still ${name}. New agent session, no context.`);
      }
      return true;
    }
    if (options?.fresh) contextEpoch += 1;
    session.setAgent(agent, { handoff: !options?.fresh });
    const installed = agents.find((choice) => choice.name === name)?.installed;
    const missing = installed ? '' : ` Its CLI (${agent.command}) is not on PATH.`;
    const context = options?.fresh
      ? ' New agent session, no context.'
      : session.get().turns.length
        ? ' It hears the conversation so far with your next prompt.'
        : '';
    notice(`Switched to ${name}.${missing}${context}`);
    return true;
  };

  const startHomeChat = (): boolean => {
    batching++;
    let ok = false;
    try {
      ok = session.clear(homeMode ? { cwd: homeDir } : undefined);
      if (ok) {
        conversationEpoch += 1;
        contextEpoch += 1;
        relayNotices.clear();
        notices = [];
        if (homeMode) {
          conversation = { id: randomUUID(), cwd: homeDir, origin: 'home' };
          lastSavedKey = '';
        }
      }
    } finally {
      batching--;
    }
    if (!ok) {
      notice('A turn is running. /stop it first, then /clear.', 'error');
      return false;
    }
    publish();
    return true;
  };

  const moveProject = (target: { cwd: string; topic?: { id: string; name: string } }): boolean => {
    batching++;
    let ok = false;
    try {
      ok = session.setCwd(target.cwd, { handoff: true });
      if (ok && homeMode) {
        conversation = {
          ...(conversation ?? { id: randomUUID(), cwd: target.cwd, origin: 'project' }),
          cwd: target.cwd,
          origin: 'project',
          ...(target.topic ? { topic: target.topic } : {}),
        };
      }
    } finally {
      batching--;
    }
    if (!ok) return false;
    publish();
    return true;
  };

  const startTopicChat = async (topicId: string): Promise<boolean> => {
    if (!homeMode) return false;
    if (session.get().status === 'running') {
      notice('Stop the running turn before starting another chat.', 'error');
      return false;
    }
    const sources = options.sessionSources ?? agentSessionSources(options.agents);
    try {
      const [store, listing, codex] = await Promise.all([
        readTopics(env).catch((): TopicStore => ({ topics: [], sessions: {} })),
        listSessions(sources, { env, readOnly: true, live: false }).catch(() => ({ sessions: [], errors: [] })),
        codexProjects({ env }).catch(() => []),
      ]);
      const topic = store.topics.find((candidate) => candidate.id === topicId);
      if (!topic) {
        notice(`No topic "${topicId}" found.`, 'error');
        return false;
      }
      const resolved = resolveTopicWorkspace(topic.id, listing.sessions, store, { env, codexProjects: codex });
      batching++;
      let ok = false;
      try {
        ok = session.clear({ cwd: resolved.cwd });
        if (ok) {
          conversationEpoch += 1;
          contextEpoch += 1;
          relayNotices.clear();
          notices = [];
          conversation = {
            id: randomUUID(),
            cwd: resolved.cwd,
            origin: resolved.origin,
            topic: { id: topic.id, name: topic.name },
          };
          lastSavedKey = '';
        }
      } finally {
        batching--;
      }
      if (!ok) {
        notice('Stop the running turn before starting another chat.', 'error');
        return false;
      }
      publish();
      if (resolved.status === 'unresolved') {
        notice(
          `No local folder found for "${topic.name}". Mention a directory (e.g. ~/src/…) to move this conversation there.`,
        );
      }
      return true;
    } catch (error) {
      notice(`Could not start a chat for that topic: ${errorText(error)}`, 'error');
      return false;
    }
  };

  const continueSession = async (id: string): Promise<boolean> => {
    const sources = options.sessionSources ?? agentSessionSources(options.agents);
    try {
      const found = await findSession(sources, id, { env });
      if (!found) {
        notice(`No session "${id}" found. \`genaicode sessions\` lists them.`, 'error');
        return false;
      }
      const { session: theirs } = found;
      if (!homeMode) {
        if (!theirs.cwd || !isWithin(theirs.cwd, options.cwd)) {
          const where = theirs.cwd
            ? ` It belongs to ${theirs.cwd}: start genaicode there with --from ${theirs.id}.`
            : '';
          notice(`That ${theirs.agent} session is not from this directory.${where}`, 'error');
          return false;
        }
        const turns = await readSession(sources, theirs);
        const agent = byName.get(session.get().agent);
        // Its own store and it can resume: no handoff needed.
        const own = !!agent?.capabilities.resume && agent.sessions?.name === theirs.source;
        if (!turns.length && !own) {
          notice(`Nothing to read in that ${theirs.agent} session.`, 'error');
          return false;
        }
        if (!session.adopt(turns, own ? { sessionId: theirs.id } : {})) {
          notice('Stop the running turn before taking over another session.', 'error');
          return false;
        }
        // Keep visible live relay cards updating in the retained transcript, but suppress context delivery.
        contextEpoch += 1;
        const name = theirs.title ?? theirs.firstPrompt ?? theirs.id;
        notice(
          own
            ? `Continuing "${name}". Your next prompt resumes that ${theirs.agent} session.`
            : `Took over "${name}" from ${theirs.agent} (${turns.length} turns). ${session.get().agent} hears it with your next prompt.`,
        );
        return true;
      }

      // `--home` mode: resolve working directory per conversation (A.1) across any project.
      let resolved = resolveSessionWorkspace(theirs, { env });
      if (resolved.status === 'unresolved') {
        const [listing, codex] = await Promise.all([
          listSessions(sources, { env, readOnly: true, live: false }).catch(() => ({ sessions: [], errors: [] })),
          codexProjects({ env }).catch(() => []),
        ]);
        resolved = resolveSessionWorkspace(theirs, { env, sessions: listing.sessions, codexProjects: codex });
      }
      const [turns, store, savedList] = await Promise.all([
        readSession(sources, theirs),
        readTopics(env).catch((): TopicStore => ({ topics: [], sessions: {} })),
        readConversations(env).catch(() => []),
      ]);
      const agent = byName.get(session.get().agent);
      const sameDir = resolved.status === 'resolved' && !!theirs.cwd && isSameDir(resolved.cwd, theirs.cwd);
      const own = sameDir && !!agent?.capabilities.resume && agent.sessions?.name === theirs.source;
      if (!turns.length && !own) {
        notice(`Nothing to read in that ${theirs.agent} session.`, 'error');
        return false;
      }
      const saved = savedList.find(
        (candidate) => candidate.sessionId === theirs.id && (!candidate.source || candidate.source === theirs.source),
      );
      const topicId = store.sessions[archiveKey(theirs)] ?? saved?.topicId;
      const topicObj =
        (topicId ? store.topics.find((candidate) => candidate.id === topicId) : undefined) ??
        (saved?.topicId && saved?.topicName ? { id: saved.topicId, name: saved.topicName } : undefined);
      const name = theirs.title ?? theirs.firstPrompt ?? saved?.title ?? theirs.id;
      batching++;
      let ok = false;
      try {
        ok = session.adopt(turns, { ...(own ? { sessionId: theirs.id } : {}), cwd: resolved.cwd, replace: true });
        if (ok) {
          conversationEpoch += 1;
          contextEpoch += 1;
          relayNotices.clear();
          notices = [];
          conversation = {
            id: saved?.id ?? randomUUID(),
            cwd: resolved.cwd,
            origin: resolved.origin,
            title: oneLine(name, 120),
            ...(topicObj ? { topic: { id: topicObj.id, name: topicObj.name } } : {}),
          };
          lastSavedKey = '';
        }
      } finally {
        batching--;
      }
      if (!ok) {
        notice('Stop the running turn before taking over another session.', 'error');
        return false;
      }
      publish();
      if (resolved.status === 'unresolved') {
        notice(
          `Took over "${name}" from ${theirs.agent}. ${resolved.reason ?? 'Original directory is no longer available.'} Mention a directory (e.g. ~/src/…) to move this conversation there.`,
        );
      } else {
        notice(
          own
            ? `Continuing "${name}". Your next prompt resumes that ${theirs.agent} session.`
            : `Took over "${name}" from ${theirs.agent} (${turns.length} turns). ${session.get().agent} hears it with your next prompt.`,
        );
      }
      return true;
    } catch (error) {
      notice(`Could not take over the session: ${errorText(error)}`, 'error');
      return false;
    }
  };

  const showIndex = async (
    name: 'sessions_waiting' | 'sessions_read',
    args: Record<string, unknown>,
    heading: string,
  ) => {
    const tool = options.sessionTools?.find((candidate) => candidate.name === name);
    if (!tool) {
      notice('Open genaicode tower or start the chat with --sessions to inspect other sessions.', 'error');
      return;
    }
    try {
      const result = await tool.call(args);
      notice(plainSessionText(`${heading}\n${outputText(result)}`));
    } catch (error) {
      notice(plainSessionText(`${heading}\n${errorText(error)}`), 'error');
    }
  };
  let sends = 0;
  const isLiveRelay = (item: Notice) => item.relay?.status === 'queued' || item.relay?.status === 'working';
  const upsertRelay = (update: SessionSendUpdate) => {
    if (closed) return;
    let epochs = relayEpochs.get(update.id);
    if (!epochs) {
      epochs = { conversation: conversationEpoch, context: contextEpoch };
      relayEpochs.set(update.id, epochs);
    } else if (epochs.conversation !== conversationEpoch) {
      return;
    }
    const reply =
      update.reply !== undefined
        ? plainSessionText(
            update.reply.length > MAX_RELAY_REPLY
              ? `${update.reply.slice(0, MAX_RELAY_REPLY).trimEnd()}\n\n… (reply truncated)`
              : update.reply,
          )
        : undefined;
    const error = update.error !== undefined ? plainSessionText(update.error) : undefined;
    const relay: ChatSessionRelay = {
      agent: plainSessionText(update.target.agent),
      sessionId: update.target.id,
      ...(update.target.title ? { title: plainSessionText(update.target.title) } : {}),
      cwd: plainSessionText(update.target.cwd),
      prompt: plainSessionText(update.text),
      status: update.status,
      startedAt: update.startedAt,
      ...(update.endedAt !== undefined ? { endedAt: update.endedAt } : {}),
      ...(update.tool ? { tool: plainSessionText(update.tool) } : {}),
      ...(update.activity ? { activity: plainSessionText(update.activity) } : {}),
      ...(reply !== undefined ? { reply } : {}),
      ...(error !== undefined ? { error } : {}),
    };
    const tone: Notice['tone'] = update.status === 'failed' ? 'error' : 'info';
    const text = relayFallbackText(update.target, relay);
    const currentTurns = session.get().turns.length;
    const settled = update.status === 'answered' || update.status === 'failed';
    if (update.status === 'answered' || update.status === 'failed') {
      relayEpochs.delete(update.id);
      if (epochs.context === contextEpoch) {
        session.addContext(
          formatSessionUpdate({
            target: update.target,
            status: update.status,
            ...(update.reply !== undefined ? { reply: update.reply } : {}),
            ...(update.error !== undefined ? { error: update.error } : {}),
          }),
        );
      }
    }
    const existingId = relayNotices.get(update.id);
    if (existingId !== undefined) {
      const index = notices.findIndex((item) => item.id === existingId);
      if (index >= 0) {
        const prior = notices[index]!;
        // Keep settled notices append-only (Ink <Static> prints newly appended items by index)
        // and land chronologically at the bottom if turns or other settled notices came after.
        const hasSettledAfter = notices.slice(index + 1).some((item) => !isLiveRelay(item));
        const moved = settled && (currentTurns > prior.afterTurn || hasSettledAfter);
        const nextItem: Notice = {
          id: prior.id,
          afterTurn: moved ? Math.max(prior.afterTurn, currentTurns) : prior.afterTurn,
          text,
          tone,
          relay,
        };
        notices = moved
          ? [...notices.slice(0, index), ...notices.slice(index + 1), nextItem]
          : notices.map((item, i) => (i === index ? nextItem : item));
        if (settled) relayNotices.delete(update.id);
        publish();
        return;
      }
    }
    const id = nextNotice++;
    if (!settled) relayNotices.set(update.id, id);
    notices = [...notices, { id, afterTurn: currentTurns, text, tone, relay }].slice(-200);
    publish();
  };
  const offSend = options.sessionSend?.attach({
    confirm: async (target, text, { queued } = {}) =>
      (await session.ask({
        id: `sessions-send-${++sends}`,
        kind: 'other',
        summary: plainSessionText(
          `${queued ? 'Queue for' : 'Send to'} ${label(target)} (${target.cwd})${queued ? ', after its current turn' : ''}:\n${text}`,
        ),
        detail: { tool: 'sessions_send', target, text, ...(queued ? { queued } : {}) },
      })) === 'approve',
    update: upsertRelay,
  });
  if (options.startupNotice) notice(options.startupNotice);
  if (options.waitingOnStart) {
    void showIndex('sessions_waiting', { limit: 5 }, 'Use /waiting [project] to refresh or /read <id> to preview.');
  }

  const web = (command: { off: boolean; invalid?: string }, source: ChatSource) => {
    if (command.invalid !== undefined) {
      notice(`Use /web or /web off (not "${command.invalid}").`, 'error');
    } else if (!options.web) {
      notice(source === 'web' ? 'This is the browser UI already.' : 'The browser UI is not available here.');
    } else if (source === 'web') {
      notice(
        command.off
          ? 'Stop the browser UI from the terminal (/web off there, or Ctrl-C).'
          : 'This is the browser UI already. The terminal shows the same session.',
      );
    } else if (command.off) {
      options.web.close().then(
        (stopped) => notice(stopped ? 'Stopped the browser UI.' : 'The browser UI is not running.'),
        (error: unknown) => notice(`Could not stop the browser UI: ${errorText(error)}`, 'error'),
      );
    } else {
      options.web.open().then(
        (url) =>
          notice(
            `Open in the browser: ${url}\nThe browser and this terminal share the session; /web off stops the server.`,
          ),
        (error: unknown) => notice(`Could not start the browser UI: ${errorText(error)}`, 'error'),
      );
    }
  };

  return {
    session,
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit(text, source = 'terminal') {
      const shell = parseShell(text);
      if (shell !== undefined) {
        runShell(shell);
        return 'ok';
      }
      if (text.trimStart().startsWith('!!')) {
        session.send(text.trimStart().slice(1));
        return 'ok';
      }
      const command = parseSlash(text);
      if (!command) {
        session.send(text.startsWith('//') ? text.slice(1) : text);
        return 'ok';
      }
      switch (command.kind) {
        case 'quit':
          return 'quit';
        case 'help':
          notice(
            [
              ...SLASH_COMMANDS.map((c) => `${c.name}${c.args ? ` ${c.args}` : ''}  ${c.help}`),
              '!command  run a shell command in the project (e.g. !npm run dev); /stop ends it, !! sends a leading !',
              'While the agent works, new prompts steer it (live agents) or wait in a queue.',
            ].join('\n'),
          );
          return 'ok';
        case 'agent':
          if (command.name) selectAgent(command.name, { fresh: command.fresh });
          else {
            notice(
              agents
                .map(
                  (a) =>
                    `${a.name === session.get().agent ? '●' : '○'} ${a.name}${!a.installed ? ' (not installed)' : a.canAsk === false ? ' (no questions)' : ''}`,
                )
                .join('\n'),
            );
          }
          return 'ok';
        case 'fallback':
          if (command.off) {
            session.setFallback(undefined);
            notice('Failover off.');
          } else if (command.names) {
            try {
              session.setFallback(fallbackAgents(command.names));
              notice(
                `Failover: when ${session.get().agent} runs out (quota, sign-in, missing CLI, crash), switch to ${command.names.join(', ')}.`,
              );
            } catch (error) {
              notice(errorText(error), 'error');
            }
          } else {
            const list = session.get().fallback;
            notice(
              list?.length
                ? `Failover: ${list.join(' → ')}. /fallback off turns it off.`
                : 'Failover is off. /fallback codex,gemini turns it on.',
            );
          }
          return 'ok';
        case 'model':
          session.setModel(command.model);
          notice(command.model ? `Model set to ${command.model}.` : "Model cleared; using the agent's default.");
          return 'ok';
        case 'effort': {
          const levels = byName.get(session.get().agent)?.capabilities.effort ?? [];
          if (command.effort === undefined) {
            notice(
              levels.length
                ? `Effort: ${session.get().effort ?? 'default'}. ${session.get().agent} takes ${levels.join(', ')}; /effort default clears it.`
                : `${session.get().agent} takes no effort setting.`,
            );
            return 'ok';
          }
          try {
            const effort = command.effort === 'default' ? undefined : command.effort;
            session.setEffort(effort);
            notice(
              effort ? `Effort set to ${effort}, from the next prompt.` : "Effort cleared; using the agent's default.",
            );
          } catch (error) {
            notice(errorText(error), 'error');
          }
          return 'ok';
        }
        case 'continue':
          if (command.id) void continueSession(command.id);
          else notice('Use /continue <session id>. `genaicode sessions` lists them.', 'error');
          return 'ok';
        case 'waiting':
          void showIndex(
            'sessions_waiting',
            { project: command.project },
            command.project ? `/waiting ${command.project}` : '/waiting',
          );
          return 'ok';
        case 'read':
          if (command.id) void showIndex('sessions_read', { id: command.id, turns: 3 }, `/read ${command.id}`);
          else notice('Use /read <session id>. /waiting shows the IDs.', 'error');
          return 'ok';
        case 'new':
          contextEpoch += 1;
          session.reset();
          notice('Next prompt starts a new agent session.');
          return 'ok';
        case 'clear':
          startHomeChat();
          return 'ok';
        case 'where': {
          const dir = session.get().cwd;
          const neutral = homeMode && isNeutralHome(dir, { env }) ? ' (neutral home)' : '';
          const topic = conversation?.topic ? ` · topic: ${conversation.topic.name}` : '';
          notice(`Working directory: ${dir}${neutral}${topic}`);
          return 'ok';
        }
        case 'stop':
          stopAll();
          return 'ok';
        case 'bark':
          if (command.invalid !== undefined) {
            notice(`Use /bark, /bark on or /bark off (not "${command.invalid}").`, 'error');
            return 'ok';
          }
          bark = command.on ?? !bark;
          notice(bark ? '🐺 Woof. The wolf barks when the agent needs you or finishes.' : '🐺 The wolf is quiet.');
          return 'ok';
        case 'auto':
          if (command.invalid !== undefined) {
            notice(`Use /auto, /auto on or /auto off (not "${command.invalid}").`, 'error');
            return 'ok';
          }
          autoApprove = command.on ?? !autoApprove;
          // What is waiting now gets the same answer as what comes next.
          if (autoApprove)
            for (const approval of session.get().approvals)
              if (approval.kind !== 'question') session.approve(approval.id, 'approve');
          notice(
            autoApprove
              ? 'Auto-approve on: every permission request is approved without asking. /auto off asks again.'
              : 'Auto-approve off: the agent asks again.',
          );
          return 'ok';
        case 'web':
          web(command, source);
          return 'ok';
        case 'unknown':
          notice(`Unknown command ${command.name}. Type /help for the list, or // to send a leading slash.`, 'error');
          return 'ok';
      }
    },
    // Esc and the Stop button too: the agent's turn and the !commands.
    stop: stopAll,
    note: (text, tone) => notice(text, tone),
    approve: (id, decision) => session.approve(id, decision),
    answer: (id, answers) => session.answer(id, answers),
    decideTower: (id, decision) => inbox?.decide(session, id, decision) ?? Promise.resolve(false),
    selectAgent,
    continueSession,
    startTopicChat,
    startHomeChat,
    moveProject,
    setModel(model) {
      session.setModel(model || undefined);
    },
    artifacts: options.artifactChannel?.store,
    close() {
      closed = true;
      clearInterval(inboxTimer);
      offInbox?.();
      inbox?.close();
      relayNotices.clear();
      relayEpochs.clear();
      offSend?.();
      stopShells();
      unsubscribe();
      listeners.clear();
      session.close();
    },
  };
}

const MAX_RELAY_REPLY = 16_000;

function relayFallbackText(target: SessionSendTarget, relay: ChatSessionRelay): string {
  const who = plainSessionText(label(target));
  switch (relay.status) {
    case 'queued':
      return `${who} is working: the message goes when its current turn ends.`;
    case 'working':
      return `${who} is working on the message.`;
    case 'failed':
      return `${who} did not take the message: ${relay.error ?? 'failed'}`;
    case 'answered':
      return relay.reply ? `${who} answered:\n${relay.reply}` : `${who} took the message.`;
  }
}

/** Stored transcripts may contain terminal controls. Keep only display text, tabs and newlines. */
export function plainSessionText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
  return stripVTControlCharacters(text).replace(/\r\n/g, '\n').replace(controls, '');
}

const SHELL_LINES = 40;
const KILL_AFTER_MS = 3000;
const SIGNALS: NodeJS.Signals[] = process.platform === 'win32' ? [] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

// `!commands` run in their own process groups, out of reach of the terminal's Ctrl-C or
// hangup: each controller with some running registers here, and they end with this process,
// however it ends. One listener for all controllers, so a signal keeps its default (exit)
// unless the host handles it too.
const shellOwners = new Set<() => void>();
const endShells = () => {
  for (const end of [...shellOwners]) end();
};
// Prepended, so it runs before the host's own listeners, one-shot ones included, and sees them.
const onShellSignal = (signal: NodeJS.Signals) => {
  endShells();
  if (process.listenerCount(signal) === 1) {
    shellOwners.clear();
    unlistenShells();
    process.kill(process.pid, signal);
  }
};
function watchShells(end: () => void) {
  if (shellOwners.has(end)) return;
  shellOwners.add(end);
  if (shellOwners.size > 1) return;
  process.on('exit', endShells);
  for (const signal of SIGNALS) process.prependListener(signal, onShellSignal);
}
function unwatchShells(end: () => void) {
  if (shellOwners.delete(end) && !shellOwners.size) unlistenShells();
}
function unlistenShells() {
  process.removeListener('exit', endShells);
  for (const signal of SIGNALS) process.removeListener(signal, onShellSignal);
}

/** Whether anything started by a `!command` still runs in its process group. */
function groupAlive(child: ChildProcess): boolean {
  if (process.platform === 'win32' || !child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ends a `!command` and what it started: its process group, or the process on Windows. */
function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // Already gone.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
