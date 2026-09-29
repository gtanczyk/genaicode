import { detectAgents } from '../agents/discovery.js';
import { createAgentSession, type AgentSession, type SessionState } from '../agents/session.js';
import type { AgentTask, ApprovalDecision, CodingAgent } from '../agents/types.js';
import { parseSlash, SLASH_COMMANDS } from './format.js';

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
}

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
  task?: Omit<AgentTask, 'prompt' | 'cwd' | 'model' | 'effort' | 'resume' | 'signal' | 'onApproval' | 'env'>;
}

export interface ChatController {
  get(): ChatView;
  subscribe(listener: (view: ChatView) => void): () => void;
  /** A prompt or a slash command. Returns 'quit' when the user asked to leave. */
  submit(text: string): 'ok' | 'quit';
  stop(): void;
  /** Show a line from the front end itself. */
  note(text: string, tone?: Notice['tone']): void;
  approve(id: string, decision: ApprovalDecision): boolean;
  selectAgent(name: string): boolean;
  setModel(model: string | undefined): void;
  close(): void;
  readonly session: AgentSession;
}

export class NoAgentError extends Error {}

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

  const session = createAgentSession({
    agent: initial,
    cwd: options.cwd,
    model: options.model,
    effort: options.effort,
    resume: options.resume,
    task: { ...options.task, env },
    autoApprove: options.approveAll ? () => 'approve' : undefined,
  });
  let notices: Notice[] = [];
  let nextNotice = 1;
  let view: ChatView = { session: session.get(), notices, agents };
  const listeners = new Set<(view: ChatView) => void>();
  const publish = () => {
    view = { session: session.get(), notices, agents };
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

  return {
    session,
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit(text) {
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
          session.stop();
          return 'ok';
        case 'unknown':
          notice(`Unknown command ${command.name}. Type /help for the list, or // to send a leading slash.`, 'error');
          return 'ok';
      }
    },
    stop: () => session.stop(),
    note: (text, tone) => notice(text, tone),
    approve: (id, decision) => session.approve(id, decision),
    selectAgent,
    setModel(model) {
      session.setModel(model || undefined);
    },
    close() {
      unsubscribe();
      listeners.clear();
      session.close();
    },
  };
}
