import { acceptsSessionPrompt } from '../agents/sessions/group.js';
import type { PendingAsk } from '../agents/sessions/answer.js';
import type { TowerDecision, TowerItem } from '../agents/sessions/tower.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { ApprovalDecision, ApprovalRequest, SandboxPolicy } from '../agents/types.js';
import { ago } from './sessions.js';
import { chatTitle, folderName, itemIsFor, sessionKey, TOWER_TURN_ITEM, waitingElsewhere } from './sidebar.js';
import { towerAction, towerChoices, towerText } from './tower-format.js';

/**
 * Where an item of the queue comes from: the open chat, another of this app's chats, or a session
 * this app did not start (what the tower watches).
 */
export type NeedsSource = 'here' | 'app' | 'tower';

/** The filters of the page (docs/design/desktop-layout.md, "Pages and sheets"). */
export type NeedsFilter = 'all' | NeedsSource | 'approvals' | 'questions';

/** Where a decision goes: each is an endpoint the page already had. */
export type NeedsDecision =
  /** An approval of the open chat (`approve` command). */
  | { via: 'chat'; id: string; decision: ApprovalDecision }
  /** An item the tower holds (`tower` command). */
  | { via: 'tower'; id: string; decision: TowerDecision }
  /** A question a hook holds open, where no tower answers it (`POST /api/asks/<id>`). */
  | { via: 'ask'; id: string; behavior: 'allow' | 'deny' };

export interface NeedsChoice {
  label: string;
  /** The answer that lets the agent go on: the button that stands out. */
  primary?: boolean;
  decision: NeedsDecision;
}

/** One thing that waits for the person. */
export interface NeedsItem {
  key: string;
  source: NeedsSource;
  /** Something to allow or refuse, or something to answer in words. */
  kind: 'approval' | 'question';
  /** What is asked for, in a few words: "Run a command", "Answer a question". */
  action: string;
  agent: string;
  /** The directory it works in: the folder's name, and the path for the tooltip. */
  project?: { name: string; path: string };
  /** The chat, session or pack task that asks: `chat “Fix the tests”`. */
  origin: string;
  /** The command, or the question. */
  text: string;
  /** `text` is a command or a message as it will be sent: shown as it is, in a box. */
  verbatim: boolean;
  /** Since when it waits, epoch milliseconds. Absent: the source does not say. */
  since?: number;
  /** The answers that can be given in place. */
  choices: NeedsChoice[];
  /** The session a reply can be sent to in place, and the sandboxes its agent offers. */
  reply?: { session: SessionInfo; sandboxes: readonly SandboxPolicy[] };
  /** Where the item is at home: the open chat, another chat of this app, or the list of sessions. */
  open: { to: 'chat' } | { to: 'own'; session: SessionInfo } | { to: 'sessions' };
  /** Why nothing can be done here, when so. */
  note?: string;
}

export interface NeedsInput {
  /** The open chat: its approvals wait in this window. */
  chat?: {
    approvals: readonly ApprovalRequest[];
    /** The running turn, as the tower's keys name it. */
    turnId?: number;
    agent: string;
    cwd: string;
    title?: string;
    id?: string;
    /** The store of the chat's agent. */
    source?: string;
  };
  tower?: readonly TowerItem[];
  /** Every agent's sessions, and the ones this app started. */
  sessions?: readonly SessionInfo[];
  own?: readonly SessionInfo[];
  /** The questions hooks hold open, and who can take a reply (`/api/sessions`). */
  asks?: readonly PendingAsk[];
  senders?: ReadonlyArray<{ agent: string; source: string; sandboxes: readonly SandboxPolicy[] }>;
  /** Since when an item waits, where its source does not say: when this window first saw it. */
  seen?: ReadonlyMap<string, number>;
  now?: number;
}

const APPROVAL_ACTION: Record<ApprovalRequest['kind'], string> = {
  command: 'Run a command',
  'file-change': 'Change files',
  question: 'Answer a question',
  other: 'Permission request',
};

const ENDING_ACTION: Record<string, string> = {
  question: 'Answer a question',
  request: 'Confirm or decide',
  command: 'Run a command yourself',
};

const projectOf = (cwd: string | undefined) => (cwd ? { name: folderName(cwd), path: cwd } : undefined);

/** The end of a message: what it asks is there. */
function lastWords(text: string | undefined, limit = 400): string {
  const paragraphs = (text ?? '').trim().split(/\n\s*\n/);
  const last = (paragraphs.at(-1) ?? '').trim();
  return last.length > limit ? `…${last.slice(-limit)}` : last;
}

const hookAsk = (item: TowerItem) => (item.id.startsWith('hook:') ? item.id.slice('hook:'.length) : undefined);

/**
 * The queue of the Needs you page: everything that waits for the person, across projects and
 * agents. The open chat's approvals first, then what the tower holds, then the sessions that ask
 * now (those that wait on a tool before those that ask in words); what waits longest comes first
 * within each. It lists exactly what `needsYou()` counts.
 */
export function needsItems(input: NeedsInput): NeedsItem[] {
  const now = input.now ?? Date.now();
  const chat = input.chat;
  const sessions = input.sessions ?? [];
  const own = new Set((input.own ?? []).map(sessionKey));
  const asks = input.asks ?? [];
  const elsewhere = waitingElsewhere({
    tower: input.tower,
    sessions,
    open: { id: chat?.id, source: chat?.source },
    now,
  });
  const sourceOf = (session: SessionInfo | undefined): NeedsSource =>
    session && own.has(sessionKey(session)) ? 'app' : 'tower';
  const openOf = (session: SessionInfo | undefined): NeedsItem['open'] =>
    session && own.has(sessionKey(session)) ? { to: 'own', session } : { to: 'sessions' };
  const named = (session: SessionInfo) => `${sourceOf(session) === 'app' ? 'chat' : 'session'} “${chatTitle(session)}”`;
  const oldestFirst = (a: NeedsItem, b: NeedsItem) => (a.since ?? now) - (b.since ?? now);

  const here = (chat?.approvals ?? []).map((request): NeedsItem => {
    const key = `chat:${request.id}`;
    // The tower knows which agent of the pack asks, and for which task.
    const told = input.tower?.find((item) => item.id === `${TOWER_TURN_ITEM}${chat!.turnId}:${request.id}`);
    const asked = request.kind === 'question';
    const decide = (decision: ApprovalDecision): NeedsDecision => ({ via: 'chat', id: request.id, decision });
    return {
      key,
      source: 'here',
      kind: asked ? 'question' : 'approval',
      action: request.scope === 'turn' ? 'Permission for this turn' : APPROVAL_ACTION[request.kind],
      agent: told?.agent ?? chat!.agent,
      project: projectOf(told?.cwd ?? chat!.cwd),
      origin: `this chat${chat!.title ? ` “${chat!.title}”` : ''}${told && told.origin !== 'Chat' ? ` · ${towerText(told.origin)}` : ''}`,
      text: asked
        ? (request.questions ?? []).map((question) => question.question).join('\n') || (request.summary ?? '')
        : towerText(request.summary ?? request.kind, true),
      verbatim: !asked,
      since: input.seen?.get(key),
      // A question has choices of its own: they are in the chat.
      choices: asked
        ? []
        : [
            {
              label: request.scope === 'turn' ? 'Approve for this turn' : 'Approve',
              primary: true,
              decision: decide('approve'),
            },
            { label: 'Deny', decision: decide('deny') },
          ],
      open: { to: 'chat' },
      ...(asked ? { note: 'Its choices are in the chat.' } : {}),
    };
  });

  const held = elsewhere.tower.map((item): NeedsItem => {
    const key = `tower:${item.id}`;
    const session = sessions.find((one) => itemIsFor(item, one));
    const ask = asks.find((one) => one.id === hookAsk(item));
    return {
      key,
      source: sourceOf(session),
      kind: 'approval',
      action: towerAction(item),
      agent: towerText(item.agent),
      project: projectOf(item.cwd),
      origin: session ? named(session) : towerText(item.origin),
      text: towerText(item.text, true),
      verbatim: true,
      since: ask?.at ?? (item.kind === 'native' ? session?.updatedAt : undefined) ?? input.seen?.get(key),
      choices: towerChoices(item).map((choice, index) => ({
        label: choice.label,
        ...(index === 0 ? { primary: true } : {}),
        decision: { via: 'tower', id: item.id, decision: choice.decision },
      })),
      open: openOf(session),
      ...(item.kind === 'native'
        ? { note: `Answer it in ${towerText(item.agent)}: its own dialog holds the question.` }
        : item.kind === 'sending'
          ? { note: 'The message is on its way.' }
          : {}),
    };
  });

  const asking = elsewhere.sessions.map((session): NeedsItem => {
    const approval = session.waitingFor === 'approval';
    // Without a tower the hook's question is answered from here.
    const ask = approval
      ? asks.filter((one) => one.agent === session.agent && one.session === session.id).sort((a, b) => a.at - b.at)[0]
      : undefined;
    const sender =
      !approval && acceptsSessionPrompt(session)
        ? input.senders?.find((one) => one.agent === session.agent && one.source === session.source)
        : undefined;
    const commands = session.waitingCommands?.map((one) => `${one.tool}  ${one.command}`).join('\n');
    return {
      key: `session:${sessionKey(session)}`,
      source: sourceOf(session),
      kind: approval ? 'approval' : 'question',
      action: approval ? 'Permission request' : (ENDING_ACTION[session.ending ?? ''] ?? 'Answer a question'),
      agent: session.agent,
      project: projectOf(session.cwd),
      origin: named(session),
      text: approval
        ? towerText(
            ask
              ? [ask.tool ?? 'Tool permission', ask.preview].filter(Boolean).join('\n')
              : commands || session.waitingTool || 'Tool permission',
            true,
          )
        : lastWords(session.lastReply) || chatTitle(session),
      verbatim: approval,
      since: ask?.at ?? session.updatedAt,
      choices: ask
        ? [
            { label: 'Approve', primary: true, decision: { via: 'ask', id: ask.id, behavior: 'allow' } },
            { label: 'Deny', decision: { via: 'ask', id: ask.id, behavior: 'deny' } },
          ]
        : [],
      ...(sender ? { reply: { session, sandboxes: sender.sandboxes } } : {}),
      open: openOf(session),
      ...(approval && !ask ? { note: `Answer it in ${session.agent}: its own dialog holds the question.` } : {}),
    };
  });

  // Among the sessions, as in their list: the ones that wait on a tool before the ones that ask.
  const toolFirst = (a: NeedsItem, b: NeedsItem) =>
    Number(b.kind === 'approval') - Number(a.kind === 'approval') || oldestFirst(a, b);
  return [...here.sort(oldestFirst), ...held.sort(oldestFirst), ...asking.sort(toolFirst)];
}

/** Whether an item is under a filter. */
export function underFilter(item: NeedsItem, filter: NeedsFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'approvals') return item.kind === 'approval';
  if (filter === 'questions') return item.kind === 'question';
  return item.source === filter;
}

/** The filter chips with how many items each holds: a count always says its scope. */
export function needsFilters(
  items: readonly NeedsItem[],
  chatTitle?: string,
): Array<{ filter: NeedsFilter; label: string; count: number }> {
  const chips: Array<[NeedsFilter, string]> = [
    ['all', 'All'],
    ['here', chatTitle || 'This chat'],
    ['app', 'This app’s chats'],
    ['tower', 'Tower: other agents’ sessions'],
    ['approvals', 'Approvals'],
    ['questions', 'Questions'],
  ];
  return chips.map(([filter, label]) => ({
    filter,
    label,
    count: items.filter((item) => underFilter(item, filter)).length,
  }));
}

/** How long an item has waited: `40m ago`, `just now`. Nothing when its source does not say. */
export function waited(since: number | undefined, now = Date.now()): string {
  if (since === undefined) return '';
  const ms = now - since;
  return ms < 60_000 ? 'just now' : `${ago(ms)} ago`;
}
