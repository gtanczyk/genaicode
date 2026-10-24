import { spawn, type ChildProcess } from 'node:child_process';
import { detectAgents } from '../agents/discovery.js';
import { createAgentSession, type AgentSession, type SessionState } from '../agents/session.js';
import type { AgentTask, ApprovalDecision, CodingAgent } from '../agents/types.js';
import { parseShell, parseSlash, SLASH_COMMANDS } from './format.js';

export interface AgentChoice {
  name: string;
  command: string;
  installed: boolean;
  resume: boolean;
  steer: boolean;
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
  selectAgent(name: string): boolean;
  setModel(model: string | undefined): void;
  close(): void;
  readonly session: AgentSession;
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

  let autoApprove = options.approveAll === true;
  const session = createAgentSession({
    agent: initial,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    resume: options.resume,
    task: { ...options.task, env },
    transformPrompt: options.transformPrompt,
    autoApprove: () => (autoApprove ? 'approve' : undefined),
  });
  let notices: Notice[] = [];
  let nextNotice = 1;
  let bark = options.bark ?? true;
  let view: ChatView = { session: session.get(), notices, agents, bark, autoApprove };
  const listeners = new Set<(view: ChatView) => void>();
  const publish = () => {
    view = { session: session.get(), notices, agents, bark, autoApprove };
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
    notices = [...notices, { id: nextNotice++, afterTurn: session.get().turns.length, text, tone }].slice(-200);
    publish();
  };

  // `!command`: the user's own shell commands, e.g. the dev server the agent just set up.
  const shells = new Set<ChildProcess>();
  /** SIGTERM, then SIGKILL for what still runs after a moment; SIGKILL at once when this process ends. */
  const stopShells = (now = false) => {
    for (const child of shells) {
      killTree(child, now ? 'SIGKILL' : 'SIGTERM');
      if (!now) {
        setTimeout(() => {
          if (shells.has(child)) killTree(child, 'SIGKILL');
        }, KILL_AFTER_MS).unref();
      }
    }
    return shells.size;
  };
  const stopAll = () => {
    session.stop();
    if (stopShells()) notice('Stopping the shell commands.');
  };
  const onExit = () => stopShells(true);
  // They run in their own process groups, out of reach of the terminal's Ctrl-C or hangup:
  // end them with this process, however it ends. A signal keeps its default (exit) unless the
  // host handles it too.
  const onSignal = (signal: NodeJS.Signals) => {
    stopShells(true);
    if (process.listenerCount(signal) === 1) {
      unwatch();
      process.kill(process.pid, signal);
    }
  };
  const watch = () => {
    process.once('exit', onExit);
    for (const signal of SIGNALS) process.on(signal, onSignal);
  };
  const unwatch = () => {
    process.removeListener('exit', onExit);
    for (const signal of SIGNALS) process.removeListener(signal, onSignal);
  };
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
    if (shells.size === 1) watch();
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
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      timer ??= setTimeout(flush, 150);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => notice(`Could not run it: ${errorText(error)}`, 'error'));
    child.on('close', (code, signal) => {
      shells.delete(child);
      if (shells.size === 0) unwatch();
      if (timer) clearTimeout(timer);
      flush();
      if (signal) notice(`${command}: stopped.`);
      else notice(`${command}: exit code ${code}.`, code ? 'error' : 'info');
    });
    setTimeout(() => {
      if (shells.has(child)) notice(`${command} keeps running here; /stop ends it.`);
    }, 3000).unref?.();
  };

  const selectAgent = (name: string): boolean => {
    const agent = byName.get(name);
    if (!agent) {
      notice(`Unknown agent "${name}". Known agents: ${[...byName.keys()].join(', ')}.`, 'error');
      return false;
    }
    if (session.get().status === 'running') {
      notice('Stop the running turn before switching agents.', 'error');
      return false;
    }
    if (agent.name === session.get().agent) return true;
    session.setAgent(agent);
    const installed = agents.find((choice) => choice.name === name)?.installed;
    notice(`Switched to ${name}.${installed ? '' : ` Its CLI (${agent.command}) is not on PATH.`} New agent session.`);
    return true;
  };

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
          if (command.name) selectAgent(command.name);
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
        case 'model':
          session.setModel(command.model);
          notice(command.model ? `Model set to ${command.model}.` : "Model cleared; using the agent's default.");
          return 'ok';
        case 'new':
          session.reset();
          notice('Next prompt starts a new agent session.');
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
          if (autoApprove) for (const approval of session.get().approvals) session.approve(approval.id, 'approve');
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
    selectAgent,
    setModel(model) {
      session.setModel(model || undefined);
    },
    close() {
      stopShells();
      unsubscribe();
      listeners.clear();
      session.close();
    },
  };
}

const SHELL_LINES = 40;
const KILL_AFTER_MS = 3000;
const SIGNALS: NodeJS.Signals[] = process.platform === 'win32' ? [] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

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
