import type { McpTool } from '../mcp-tools.js';
import type { AgentResult, CodingAgent } from '../types.js';
import { agentSessionSources, findSession } from './index.js';
import { sessionWithLive } from './live.js';
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
  /**
   * Ask the person whether `text` may go to `target`. Resolves true to send. `queued`: the session
   * is working now, so the message would go as its next turn, once the current one ends.
   */
  confirm(target: SessionSendTarget, text: string, options?: { queued?: boolean }): Promise<boolean>;
  /** The message waits for the session's current turn to end. */
  queued?(target: SessionSendTarget, text: string): void;
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
  /** The last message to each session, sent or still waiting: the next one goes after it. */
  private readonly lines = new Map<string, Promise<unknown>>();

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

  async allow(target: SessionSendTarget, text: string, queued = false): Promise<boolean> {
    const handler = this.handler;
    if (!handler) return false;
    const key = keyOf(target);
    if (this.allowed.has(key)) return true;
    const yes = queued ? handler.confirm(target, text, { queued }) : handler.confirm(target, text);
    if (!(await yes) || this.handler !== handler) return false;
    this.allowed.add(key);
    return true;
  }

  /** Whether a message to `target` from this chat is still being sent or waiting. */
  pending(target: Pick<SessionSendTarget, 'source' | 'id'>): boolean {
    return this.lines.has(keyOf(target));
  }

  /** Run `send` after every earlier message to the same session finished, in the order given. */
  line(target: Pick<SessionSendTarget, 'source' | 'id'>, send: () => Promise<unknown>): Promise<unknown> {
    const key = keyOf(target);
    const work = (this.lines.get(key) ?? Promise.resolve()).then(send, send);
    this.lines.set(key, work);
    void work.then(
      () => this.lines.get(key) === work && this.lines.delete(key),
      () => this.lines.get(key) === work && this.lines.delete(key),
    );
    this.track(work);
    return work;
  }

  noteQueued(target: SessionSendTarget, text: string) {
    try {
      this.handler?.queued?.(target, text);
    } catch {
      // A broken view does not fail the send.
    }
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
  /** Ends the turns still running in other sessions, and drops queued messages, when the chat closes. */
  signal?: AbortSignal;
  /** How often a queued message checks whether its session's turn ended. Default 5 s. */
  pollMs?: number;
  /** A queued message is dropped when its session still works after this long. Default 6 h. */
  maxWaitMs?: number;
}

const POLL_MS = 5_000;
const MAX_WAIT_MS = 6 * 3600_000;

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
      'Send a message to another local coding-agent session, as a new turn in it, when the user asks you to tell, ask or pass something to it. Find the session with sessions_list or sessions_waiting first and use its full id. A session that is working right now gets the message queued: it goes as the next turn of that session once the current one ends, and the tool says so ("Queued"); do not hold the message back or ask the user to remind you. The user confirms the first message to each session. The tool returns once the message is sent or queued; the session answers in its own conversation, read it later with sessions_read.',
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
      const query = { env: options.env, signal: options.signal };
      const found = await findSession(stores, id, query);
      if (!found || found.session.id !== id) throw new SessionSendError('missing');
      const expectedTarget = { agent: found.session.agent, cwd: found.session.cwd };
      let recipient: { session: SessionInfo; cwd: string };
      let queued = gate.pending(found.session);
      try {
        // Checked before the question: no point asking about a session that cannot take it.
        recipient = await sessionRecipient(local, found.session, options.env);
      } catch (error) {
        if (!(error instanceof SessionSendError) || !(await isWorking(error, found.session, options.env))) throw error;
        queued = true;
        recipient = { session: found.session, cwd: found.session.cwd! };
      }
      const target = targetOf(recipient.session, recipient.cwd);
      if (!(await gate.allow(target, text, queued))) return 'The user did not allow this message. Nothing was sent.';
      const send = () =>
        sendSession(local, target.id, text, {
          source: target.source,
          env: options.env,
          signal: options.signal,
          expectedTarget,
          // Unfinished sessions take a message too, as `sessions send` lets them.
          waitingOnly: false,
        });
      const deliver = async () => {
        try {
          // The session can start a turn, or another sender take it, after the check: then it waits too.
          const result = await whenFree(send, options, {
            // A refusal for its state waits only while the session is in a turn, not when it was archived.
            retry: async (error) => {
              if (error.reason !== 'state') return true;
              const now = await findSession(stores, target.id, query);
              return !!now && (await isWorking(error, now.session, options.env));
            },
            onWait: () => !queued && gate.noteQueued(target, text),
          });
          gate.report(target, { result });
        } catch (error) {
          gate.report(target, { error: error instanceof Error ? error.message : String(error) });
        }
      };
      void gate.line(target, deliver);
      if (!queued)
        return `Sent to ${label(target)}. It answers in its own conversation; read it later with sessions_read.`;
      gate.noteQueued(target, text);
      return (
        `Queued for ${label(target)}: it is working now, so the message goes as its next turn when the current one ends. ` +
        'Nothing more to do; the chat shows its answer, or read it later with sessions_read. A queued message is dropped if this chat closes first.'
      );
    },
  };
}

/** Refusals that only mean the session is in the middle of a turn: a message can wait for its end. */
const WAIT_REASONS = new Set<SessionSendError['reason']>(['state', 'approval', 'busy']);

/** The refusal is for a turn still running (or asking for approval), not for a session that cannot take prompts. */
async function isWorking(error: SessionSendError, found: SessionInfo, env?: NodeJS.ProcessEnv): Promise<boolean> {
  if (!WAIT_REASONS.has(error.reason)) return false;
  if (error.reason !== 'state') return true;
  const session = await sessionWithLive(found, env);
  return (
    session.where === 'local' &&
    !!session.cwd &&
    !session.archived &&
    (session.turnInProgress === true || session.state === 'active')
  );
}

/** Send once the session's turn is over: retry while it still says it is working, until the wait runs out. */
async function whenFree(
  send: () => Promise<AgentResult>,
  options: SessionSendToolOptions,
  { retry, onWait }: { retry(error: SessionSendError): Promise<boolean>; onWait?(): void },
): Promise<AgentResult> {
  let waited = false;
  const pollMs = options.pollMs ?? POLL_MS;
  const until = Date.now() + (options.maxWaitMs ?? MAX_WAIT_MS);
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof SessionSendError) || !WAIT_REASONS.has(error.reason) || !(await retry(error))) throw error;
      if (!waited) {
        waited = true;
        onWait?.();
      }
      if (Date.now() >= until)
        throw new Error(
          `It was still working after ${Math.round((options.maxWaitMs ?? MAX_WAIT_MS) / 60_000)} min; the queued message was not sent.`,
        );
    }
    await sleep(pollMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    };
    const stop = () => {
      done();
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function keyOf(target: Pick<SessionSendTarget, 'source' | 'id'>): string {
  return `${target.source}:${target.id}`;
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
