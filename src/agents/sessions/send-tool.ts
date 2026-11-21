import type { McpTool } from '../mcp-tools.js';
import type { AgentResult, CodingAgent } from '../types.js';
import { agentSessionSources, findSession } from './index.js';
import { sendSession, sessionRecipient, SessionSendError } from './send.js';
import type { SessionInfo } from './types.js';

/** Who a message goes to, as the person is asked about it. */
export interface SessionSendTarget {
  source: string;
  id: string;
  agent: string;
  title?: string;
  cwd: string;
}

/** What the chat that gives an agent `sessions_send` does with it: asks the person, shows the answer. */
export interface SessionSendHandler {
  /** Ask the person whether `text` may go to `target`. Resolves true to send. */
  confirm(target: SessionSendTarget, text: string): Promise<boolean>;
  /** The target session's turn ended: `result`, or the error it failed with. */
  done?(target: SessionSendTarget, outcome: { result?: AgentResult; error?: string }): void;
}

/**
 * Lets an agent send a message to another local session (`sendSession`) when the person asks it
 * to ("tell Codex in knights that..."). The first message to each session waits for the chat's
 * `confirm`; once the person agreed, later ones to that session go without asking while this
 * gate lives. Without a handler attached every message is refused.
 */
export class SessionSendGate {
  private handler?: SessionSendHandler;
  private readonly allowed = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();

  /** Attach the chat that asks and shows. Returns the detach. */
  attach(handler: SessionSendHandler): () => void {
    // What the person allowed was allowed to the chat they allowed it in.
    this.allowed.clear();
    this.handler = handler;
    return () => {
      if (this.handler !== handler) return;
      this.handler = undefined;
      this.allowed.clear();
    };
  }

  async allow(target: SessionSendTarget, text: string): Promise<boolean> {
    const handler = this.handler;
    if (!handler) return false;
    const key = `${target.source}:${target.id}`;
    if (this.allowed.has(key)) return true;
    if (!(await handler.confirm(target, text)) || this.handler !== handler) return false;
    this.allowed.add(key);
    return true;
  }

  report(target: SessionSendTarget, outcome: { result?: AgentResult; error?: string }) {
    try {
      this.handler?.done?.(target, outcome);
    } catch {
      // A broken view does not fail the send.
    }
  }

  track(work: Promise<unknown>) {
    this.running.add(work);
    void work.finally(() => this.running.delete(work));
  }

  /** Resolves once every message sent so far got its answer (for tests and a clean exit). */
  async settled(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }
}

export interface SessionSendToolOptions {
  env?: NodeJS.ProcessEnv;
  /** Ends the turns still running in other sessions, when the chat closes. */
  signal?: AbortSignal;
}

const MAX_TEXT = 32_000;

/** `sessions_send`: the agent's half of `SessionSendGate`. Give it beside `sessionTools()`. */
export function sessionSendTool(
  agents: readonly CodingAgent[],
  gate: SessionSendGate,
  options: SessionSendToolOptions = {},
): McpTool {
  const local = agents.filter((agent) => agent.sessions?.where === 'local' && agent.capabilities.resume);
  const sources = agentSessionSources(local);
  return {
    name: 'sessions_send',
    description:
      'Send a message to another local coding-agent session, as a new turn in it, when the user asks you to tell, ask or pass something to it. Find the session with sessions_list or sessions_waiting first and use its full id. The session must be waiting or unfinished, not running. The user confirms the first message to each session. The tool returns once the message is sent; the session answers in its own conversation, read it later with sessions_read.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The full session id.' },
        source: { type: 'string', description: 'Its store (agent) name, when the same id is in two stores.' },
        text: { type: 'string', maxLength: MAX_TEXT, description: 'The message, as the user would write it.' },
      },
      required: ['id', 'text'],
    },
    call: async ({ id, source, text }) => {
      if (typeof id !== 'string' || !id.trim() || typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT)
        throw new Error(`Provide a session id and a message of 1-${MAX_TEXT} characters.`);
      // Newlines and tabs are fine. Other controls could make what the user saw differ from what is sent.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/u.test(text))
        throw new Error('Use plain message text without terminal or direction controls.');
      const stores = typeof source === 'string' ? sources.filter((s) => s.name === source) : sources;
      const found = await findSession(stores, id, { env: options.env, signal: options.signal });
      if (!found || found.session.id !== id) throw new SessionSendError('missing');
      // Checked before the question: no point asking about a session that cannot take it.
      const { session, cwd } = await sessionRecipient(local, found.session, options.env);
      const target = targetOf(session, cwd);
      if (!(await gate.allow(target, text))) return 'The user did not allow this message. Nothing was sent.';
      const work = sendSession(local, session.id, text, {
        source: session.source,
        env: options.env,
        signal: options.signal,
        expectedTarget: { agent: found.session.agent, cwd: found.session.cwd },
        // Unfinished sessions take a message too, as `sessions send` lets them.
        waitingOnly: false,
      }).then(
        (result) => gate.report(target, { result }),
        (error: unknown) => gate.report(target, { error: error instanceof Error ? error.message : String(error) }),
      );
      gate.track(work);
      return `Sent to ${label(target)}. It answers in its own conversation; read it later with sessions_read.`;
    },
  };
}

function targetOf(session: SessionInfo, cwd: string): SessionSendTarget {
  return {
    source: session.source,
    id: session.id,
    agent: session.agent,
    ...(session.title ? { title: session.title } : {}),
    cwd,
  };
}

/** `codex · "Knights concept"`, for messages about a send. */
export function label(target: SessionSendTarget): string {
  return target.title ? `${target.agent} · "${target.title}"` : `${target.agent} · ${target.id.slice(0, 8)}`;
}
