import { randomUUID } from 'node:crypto';
import type { McpTool } from '../mcp-tools.js';
import type { AgentSession, SessionState } from '../session.js';
import type { ApprovalDecision, ApprovalRequest, CodingAgent } from '../types.js';
import { answerAsk, asksForSession, pendingAsks } from './answer.js';
import { agentSessionSources, findSession, listSessions } from './index.js';
import { sendSession, sessionRecipient, SessionSendError } from './send.js';

export type TowerDecision = ApprovalDecision | 'send' | 'dismiss';

interface Recipient {
  agent: string;
  source: string;
  sessionId: string;
  cwd: string;
}

/** Only display data crosses the browser boundary. Decisions refer back to a single server-owned item. */
export interface TowerItem {
  id: string;
  kind: 'approval' | 'native' | 'proposal' | 'sending';
  agent: string;
  cwd?: string;
  origin: string;
  text: string;
  /** A proposal or its follow-up question points to a session without replacing its own waiting item. */
  recipient?: Pick<Recipient, 'source' | 'sessionId'>;
  scope?: ApprovalRequest['scope'];
  /** The session of another agent that asks, so a count of what waits takes it once. */
  sessionId?: string;
  /** The store that lists that session, when the item comes from one: ids repeat across stores. */
  source?: string;
}

export interface TowerView {
  items: TowerItem[];
  unavailable: string[];
  status?: string;
}

function turnQuestions(state: SessionState, chat?: string): TowerItem[] {
  const turn = state.turns.at(-1);
  if (!turn || turn.result) return [];
  return state.approvals.map((request) => {
    const task = turn.pack?.tasks.find((t) => t.id === request.subtaskId);
    return {
      id: turnKey(turn.id, request.id, chat),
      kind: 'approval',
      agent: task?.agent ?? turn.pack?.lead ?? turn.agent,
      cwd: task?.cwd ?? state.cwd,
      origin: task ? `Pack task ${task.id}` : turn.pack ? 'Pack lead' : 'Chat',
      text: request.summary ?? request.kind,
      scope: request.scope,
    };
  });
}

const turnKey = (turn: number, id: string, chat?: string) => `turn:${chat ? chat + ':' : ''}${turn}:${id}`;
const recipientLabel = (target: Recipient) => `${target.source} / ${target.sessionId}`;

/** One operator's tower. Only proposalTool is given to the lead. */
export class TowerInbox {
  private readonly sources;
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly drafts = new Map<string, { target: Recipient; text: string; sending: boolean }>();
  private readonly runningQuestions = new Map<string, { item: TowerItem; answer(decision: ApprovalDecision): void }>();
  private external: TowerItem[] = [];
  private unavailable: string[] = [];
  private status?: string;
  private reading?: Promise<void>;

  constructor(
    private readonly agents: readonly CodingAgent[],
    private readonly env: NodeJS.ProcessEnv,
  ) {
    this.sources = agentSessionSources(agents).filter((s) => s.where === 'local');
  }

  readonly proposalTool: McpTool = {
    name: 'propose_session_message',
    description:
      'Draft a message for an existing, waiting local session. Use the full session id from sessions_waiting. The operator reviews its recipient and exact text and chooses whether to send it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        source: { type: 'string', description: 'Store name, to distinguish the same id in two stores.' },
        text: { type: 'string', maxLength: 32000 },
      },
      required: ['id', 'text'],
    },
    call: async ({ id, source, text }) => {
      if (typeof id !== 'string' || !id.trim() || typeof text !== 'string' || !text.trim() || text.length > 32000)
        throw new Error('Provide a session id and a message of 1–32000 characters.');
      // Newlines and tabs are fine. Other controls could make the reviewed message differ from the sent text.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text))
        throw new Error('Use plain message text without terminal or direction controls.');
      const stores = source === undefined ? this.sources : this.sources.filter((s) => s.name === source);
      const found = await findSession(stores, id, { env: this.env, signal: this.lifetime.signal });
      if (!found || found.session.id !== id) throw new SessionSendError('missing');
      const { session, cwd } = await sessionRecipient(this.agents, found.session, this.env, true);
      this.lifetime.signal.throwIfAborted();
      if (this.drafts.size >= 64) throw new Error('The tower already has 64 open message proposals.');
      const target = { source: session.source, agent: session.agent, sessionId: session.id, cwd };
      this.drafts.set(randomUUID(), { target, text, sending: false });
      this.publish();
      return `Proposed a message to ${recipientLabel(target)}. Awaiting the operator's decision.`;
    },
  };

  view(state: SessionState, chat?: string): TowerView {
    const items = [
      ...turnQuestions(state, chat),
      ...this.external,
      ...Array.from(this.runningQuestions.values(), (q) => q.item),
    ];
    for (const [id, draft] of this.drafts) {
      const { target, text, sending } = draft;
      items.push({
        id,
        kind: sending ? 'sending' : 'proposal',
        agent: target.agent,
        cwd: target.cwd,
        origin: recipientLabel(target),
        recipient: { source: target.source, sessionId: target.sessionId },
        text,
      });
    }
    return { items, unavailable: this.unavailable, status: this.status };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }

  refresh(): Promise<void> {
    return (this.reading ??= this.readExternal().finally(() => {
      this.reading = undefined;
    }));
  }

  private async readExternal() {
    const query = { env: this.env, readOnly: true, since: Date.now() - 7 * 86400_000, signal: this.lifetime.signal };
    const [listing, asks] = await Promise.all([listSessions(this.sources, query), pendingAsks(this.env, query)]);
    if (this.lifetime.signal.aborted) return;
    const items: TowerItem[] = asks.map((ask) => ({
      id: `hook:${ask.id}`,
      kind: 'approval',
      agent: ask.agent,
      cwd: ask.cwd,
      origin: `Session ${ask.session}`,
      sessionId: ask.session,
      text: [ask.tool ?? 'Tool permission', ask.preview].filter(Boolean).join('\n'),
    }));
    for (const s of listing.sessions) {
      if (s.archived || s.waitingFor !== 'approval' || asksForSession(asks, s).length) continue;
      items.push({
        id: `native:${JSON.stringify([s.source, s.id])}`,
        kind: 'native',
        agent: s.agent,
        cwd: s.cwd,
        origin: `Session ${s.id}`,
        sessionId: s.id,
        source: s.source,
        text: s.waitingCommands?.map((c) => `${c.tool}  ${c.command}`).join('\n') || s.waitingTool || 'Tool permission',
      });
    }
    const unavailable = listing.errors.map((e) => e.source).sort();
    if (JSON.stringify([items, unavailable]) === JSON.stringify([this.external, this.unavailable])) return;
    this.external = items;
    this.unavailable = unavailable;
    this.publish();
  }

  async decide(session: AgentSession, id: string, decision: TowerDecision, chat?: string): Promise<boolean> {
    if (this.lifetime.signal.aborted) return false;
    if (decision === 'send' || decision === 'dismiss') {
      const draft = this.drafts.get(id);
      if (!draft || draft.sending) return false;
      if (decision === 'dismiss') {
        this.drafts.delete(id);
        this.status = `Dismissed the message to ${recipientLabel(draft.target)}.`;
      } else {
        // Claim synchronously across every connected operator view. A failed run may have received the message.
        draft.sending = true;
        void this.deliver(id, draft.target, draft.text);
      }
      this.publish();
      return true;
    }
    const state = session.get();
    const turn = state.turns.at(-1);
    const request = turn && !turn.result && state.approvals.find((r) => turnKey(turn.id, r.id, chat) === id);
    if (request) return session.approve(request.id, decision);
    const question = this.runningQuestions.get(id);
    if (question) {
      question.answer(decision);
      return true;
    }
    if (!this.external.some((item) => item.kind === 'approval' && item.id === id)) return false;
    const ok = await answerAsk(
      id.slice('hook:'.length),
      { behavior: decision === 'approve' ? 'allow' : 'deny' },
      this.env,
    );
    await this.refresh();
    return ok;
  }

  private async deliver(id: string, target: Recipient, text: string) {
    const label = recipientLabel(target);
    const finished = new AbortController();
    try {
      const result = await sendSession(this.agents, target.sessionId, text, {
        expectedTarget: target,
        source: target.source,
        env: this.env,
        signal: this.lifetime.signal,
        onApproval: (request, signal) =>
          this.ask(
            target,
            request,
            AbortSignal.any([finished.signal, this.lifetime.signal, ...(signal ? [signal] : [])]),
          ),
      });
      this.status = result.ok
        ? `Message sent to ${label}.`
        : `The turn in ${label} ended with status ${result.status}.`;
    } catch (error) {
      this.status = `Could not send to ${label}. ${error instanceof SessionSendError ? error.publicMessage : 'The session driver failed.'}`;
    } finally {
      finished.abort();
      this.drafts.delete(id);
      this.publish();
    }
  }

  private ask(target: Recipient, request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    if (signal.aborted) return Promise.resolve('deny');
    const id = randomUUID();
    return new Promise((resolve) => {
      const answer = (decision: ApprovalDecision) => {
        this.runningQuestions.delete(id);
        signal.removeEventListener('abort', cancel);
        resolve(decision);
        this.publish();
      };
      const cancel = () => answer('deny');
      signal.addEventListener('abort', cancel, { once: true });
      this.runningQuestions.set(id, {
        item: {
          id,
          kind: 'approval',
          agent: target.agent,
          cwd: target.cwd,
          origin: recipientLabel(target),
          recipient: { source: target.source, sessionId: target.sessionId },
          text: request.summary ?? request.kind,
          scope: request.scope,
        },
        answer,
      });
      this.publish();
    });
  }

  close() {
    this.listeners.clear();
    this.lifetime.abort();
    this.drafts.clear();
  }
}
