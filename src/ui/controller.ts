import { spawn, type ChildProcess } from 'node:child_process';
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
import { agentSessionSources, findSession, readSession } from '../agents/sessions/index.js';
import { isWithin } from '../agents/sessions/files.js';
import type { SessionSource } from '../agents/sessions/types.js';
import type { TowerInbox, TowerDecision, TowerView } from '../agents/sessions/tower.js';
import { label, type SessionSendGate } from '../agents/sessions/send-tool.js';
import type {
  AgentBudget,
  AgentMode,
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
  /** The effort levels it takes, in its own words. Absent: none. */
  effort?: readonly string[];
  /** Supports Plan mode (`/plan`). */
  plan?: boolean;
}

/** A line from the front end itself (agent switched, help...), shown after turn `afterTurn`. */
export interface Notice {
  id: number;
  afterTurn: number;
  text: string;
  tone: 'info' | 'error';
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
  mode?: AgentMode;
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
  task?: Omit<AgentTask, 'prompt' | 'cwd' | 'model' | 'effort' | 'mode' | 'resume' | 'signal' | 'onApproval' | 'env'>;
  /** Caps on the whole session (`AgentSessionOptions.budget`). */
  budget?: AgentBudget;
  /** Let the agent publish artifacts (`genaicode chat` and `ui` do unless `--no-artifacts`). Default true. */
  artifacts?: boolean;
  /** The running artifact channel, started by the front end (`AgentSessionOptions.artifacts`). */
  artifactChannel?: { store: ArtifactStore; mcpServer?: McpServer };
  /** The running `ask_user` channel (`AgentSessionOptions.questions`), started by the front end. */
  questionChannel?: AgentSessionOptions['questions'];
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
   * Take over the session with this id (any agent's, in this directory or below it): its turns
   * join the chat and the current agent continues it, resuming when the session is its own and
   * getting a handoff otherwise. Resolves false, with a notice, when it cannot.
   */
  continueSession(id: string): Promise<boolean>;
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
    ...(agent.capabilities.effort?.length ? { effort: agent.capabilities.effort } : {}),
    ...(agent.capabilities.plan ? { plan: true } : {}),
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
  const session = createAgentSession({
    ...(options.fallback?.length ? { fallback: fallbackAgents(options.fallback) } : {}),
    agent: initial,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    mode: options.mode,
    resume: options.resume,
    task: { ...options.task, env },
    ...(options.budget ? { budget: options.budget } : {}),
    transformPrompt: options.transformPrompt,
    ...(options.artifactChannel ? { artifacts: options.artifactChannel } : {}),
    ...(options.questionChannel ? { questions: options.questionChannel } : {}),
    autoApprove: () => (autoApprove ? 'approve' : undefined),
  });
  let notices: Notice[] = [];
  let closed = false;
  let nextNotice = 1;
  let bark = options.bark ?? true;
  const inbox = options.towerInbox;
  const shells = new Set<ChildProcess>();
  const snapshot = (): ChatView => {
    const state = session.get();
    return {
      session: state,
      notices,
      agents,
      bark,
      autoApprove,
      shells: shells.size,
      ...(inbox ? { tower: inbox.view(state) } : {}),
    };
  };
  let view = snapshot();
  const listeners = new Set<(view: ChatView) => void>();
  const publish = () => {
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
        cwd: options.cwd,
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
        session.setAgent(agent, { handoff: false });
        notice(`Still ${name}. New agent session, no context.`);
      }
      return true;
    }
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

  const continueSession = async (id: string): Promise<boolean> => {
    const sources = options.sessionSources ?? agentSessionSources(options.agents);
    try {
      const found = await findSession(sources, id, { env });
      if (!found) {
        notice(`No session "${id}" found. \`genaicode sessions\` lists them.`, 'error');
        return false;
      }
      const { session: theirs } = found;
      if (!theirs.cwd || !isWithin(theirs.cwd, options.cwd)) {
        const where = theirs.cwd ? ` It belongs to ${theirs.cwd}: start genaicode there with --from ${theirs.id}.` : '';
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
      if (!session.adopt(turns, own ? { sessionId: theirs.id, ...(theirs.mode ? { mode: theirs.mode } : {}) } : {})) {
        notice('Stop the running turn before taking over another session.', 'error');
        return false;
      }
      const name = theirs.title ?? theirs.firstPrompt ?? theirs.id;
      notice(
        own
          ? `Continuing "${name}". Your next prompt resumes that ${theirs.agent} session.`
          : `Took over "${name}" from ${theirs.agent} (${turns.length} turns). ${session.get().agent} hears it with your next prompt.`,
      );
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
    queued: (target) =>
      notice(plainSessionText(`${label(target)} is working: the message goes when its current turn ends.`)),
    done: (target, { result, error }) => {
      const failed = error ?? (result && !result.ok ? (result.error ?? result.status) : undefined);
      if (failed) return notice(plainSessionText(`${label(target)} did not take the message: ${failed}`), 'error');
      const reply = result?.text?.trim().slice(0, 800);
      notice(plainSessionText(reply ? `${label(target)} answered:\n${reply}` : `${label(target)} took the message.`));
    },
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
                    `${a.name === session.get().agent ? '●' : '○'} ${a.name}${a.installed ? '' : ' (not installed)'}`,
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
          session.reset();
          notice('Next prompt starts a new agent session.');
          return 'ok';
        case 'clear':
          if (session.clear()) {
            notices = [];
            publish();
          } else notice('A turn is running. /stop it first, then /clear.', 'error');
          return 'ok';
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
        case 'plan': {
          if (command.invalid !== undefined) {
            notice(`Use /plan, /plan on or /plan off (not "${command.invalid}").`, 'error');
            return 'ok';
          }
          const on = command.on ?? session.get().mode !== 'plan';
          try {
            session.setMode(on ? 'plan' : 'default');
            notice(
              on
                ? 'Plan mode on: from the next prompt, the agent plans and asks without editing. /plan off leaves it.'
                : 'Plan mode off: back to normal mode from the next prompt.',
            );
          } catch (error) {
            notice(errorText(error), 'error');
          }
          return 'ok';
        }
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
    setModel(model) {
      session.setModel(model || undefined);
    },
    artifacts: options.artifactChannel?.store,
    close() {
      closed = true;
      clearInterval(inboxTimer);
      offInbox?.();
      inbox?.close();
      offSend?.();
      stopShells();
      unsubscribe();
      listeners.clear();
      session.close();
    },
  };
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
