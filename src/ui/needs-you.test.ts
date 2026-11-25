import { describe, expect, it } from 'vitest';
import type { PendingAsk } from '../agents/sessions/answer.js';
import type { TowerItem } from '../agents/sessions/tower.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import {
  chatsWithoutAnswered,
  needsFilters,
  needsItems,
  needsSessions,
  underFilter,
  waited,
  withoutAnswered,
  type NeedsInput,
} from './needs-you.js';
import { needsYou } from './sidebar.js';

const now = Date.parse('2026-11-25T10:00:00Z');
const MIN = 60_000;
const session = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id,
  where: 'local',
  cwd: '/work/app',
  title: `Chat ${id}`,
  state: 'waiting',
  updatedAt: now - 40 * MIN,
  ...patch,
});
const asking = (id: string, patch: Partial<SessionInfo> = {}) =>
  session(id, {
    ending: 'question',
    lastReply: 'I looked at both.\n\nRetry on 502 too, or only on timeouts?',
    ...patch,
  });

// One of each source: the open chat, this app's other chats, the tower, another agent's sessions.
const own = [session('open'), asking('gate', { title: 'Gate verdict retries', cwd: '/work/site' })];
const sessions = [
  ...own,
  asking('flaky', { source: 'codex', agent: 'codex', title: 'Fix flaky tower test', updatedAt: now - 3 * 60 * MIN }),
  session('native', { source: 'gemini', agent: 'gemini', waitingFor: 'approval', waitingTool: 'Shell' }),
  session('hooked', { source: 'codex', agent: 'codex', waitingFor: 'approval', title: 'Ship it' }),
  session('idle', { source: 'codex', agent: 'codex' }),
];
const tower: TowerItem[] = [
  {
    id: 'turn:4:req-1',
    kind: 'approval',
    agent: 'codex',
    cwd: '/work/app/wt',
    origin: 'Pack task t3',
    text: 'npm test',
  },
  {
    id: 'hook:abc',
    kind: 'approval',
    agent: 'codex',
    cwd: '/work/lib',
    origin: 'Session hooked',
    sessionId: 'hooked',
    text: 'Bash\nnpm publish',
  },
  {
    id: 'native:["gemini","native"]',
    kind: 'native',
    agent: 'gemini',
    cwd: '/work/app',
    origin: 'Session native',
    sessionId: 'native',
    source: 'gemini',
    text: 'Shell',
  },
  { id: 'draft-1', kind: 'proposal', agent: 'codex', cwd: '/work/lib', origin: 'codex / flaky', text: 'Go on.' },
];
const asks: PendingAsk[] = [
  { id: 'abc', agent: 'codex', session: 'hooked', tool: 'Bash', preview: 'npm publish', at: now - 5 * MIN, pid: 1 },
];
const input: NeedsInput = {
  chat: {
    approvals: [
      { id: 'req-1', kind: 'command', summary: 'npm test', subtaskId: 't3' },
      { id: 'req-2', kind: 'question', questions: [{ id: 'q', question: 'Which branch?', options: [] }] },
    ],
    turnId: 4,
    agent: 'claude',
    cwd: '/work/app',
    title: 'Ship the layout',
    id: 'open',
    source: 'claude',
  },
  tower,
  sessions,
  own,
  asks,
  senders: [
    { agent: 'claude', source: 'claude', sandboxes: ['read-only'] },
    { agent: 'codex', source: 'codex', sandboxes: [] },
  ],
  seen: new Map([
    ['chat:req-1', now - 2 * MIN],
    ['tower:draft-1', now - 10_000],
  ]),
  now,
};
const count = (from: NeedsInput) =>
  needsYou({
    approvals: from.chat?.approvals.length ?? 0,
    tower: from.tower,
    sessions: needsSessions(from.sessions, from.own, from.asks),
    open: { id: from.chat?.id, source: from.chat?.source },
    now,
  }).total;
const item = (key: string, from = input) => needsItems(from).find((one) => one.key === key)!;

describe('needsItems', () => {
  it('asks for approval where a hook question is open though the row was read before it', () => {
    // Without a tower: the listing read the session at work, then found the hook's question.
    const late: NeedsInput = {
      sessions: [session('late', { source: 'codex', agent: 'codex', state: 'active' })],
      asks: [
        { id: 'q1', agent: 'codex', session: 'late', tool: 'Bash', preview: 'rm -rf dist', at: now - MIN, pid: 1 },
      ],
      now,
    };
    const items = needsItems(late);
    expect(items.map((one) => [one.key, one.kind, one.text])).toEqual([
      ['session:codex:late:q1', 'approval', 'Bash\nrm -rf dist'],
    ]);
    expect(items[0]!.choices.map((one) => one.decision)).toEqual([
      { via: 'ask', id: 'q1', behavior: 'allow' },
      { via: 'ask', id: 'q1', behavior: 'deny' },
    ]);
    expect(count(late)).toBe(1);
  });

  it('asks for approval where a hook question is open though the row says approval and still at work', () => {
    // The Codex app server reported approval, then a live record read before it set the row to work.
    const stale: NeedsInput = {
      sessions: [session('stale', { source: 'codex', agent: 'codex', state: 'active', waitingFor: 'approval' })],
      asks: [
        { id: 'q2', agent: 'codex', session: 'stale', tool: 'Bash', preview: 'npm publish', at: now - MIN, pid: 1 },
      ],
      now,
    };
    expect(needsSessions(stale.sessions, [], stale.asks)[0]).toMatchObject({
      state: 'waiting',
      waitingFor: 'approval',
    });
    expect(needsItems(stale).map((one) => [one.key, one.kind])).toEqual([['session:codex:stale:q2', 'approval']]);
    expect(count(stale)).toBe(1);
  });

  it('lists what the sidebar counts, each request once', () => {
    const items = needsItems(input);
    expect(items.map((one) => one.key)).toEqual([
      'chat:req-1',
      'chat:req-2',
      // The longest wait first, within the tower's and within the sessions.
      'tower:native:["gemini","native"]',
      'tower:hook:abc',
      'tower:draft-1',
      'session:codex:flaky',
      'session:claude:gate',
    ]);
    expect(items).toHaveLength(count(input));
    // Without a tower the sessions that ask for a tool are items of their own: still one each.
    const bare = { ...input, tower: undefined };
    expect(needsItems(bare)).toHaveLength(count(bare));
    // Among the sessions, those that wait on a tool come before those that ask in words.
    expect(needsItems(bare).map((one) => one.key)).toEqual([
      'chat:req-1',
      'chat:req-2',
      'session:gemini:native',
      'session:codex:hooked:abc',
      'session:codex:flaky',
      'session:claude:gate',
    ]);
    // Nothing at all.
    expect(needsItems({ now })).toEqual([]);
    expect(count({ now })).toBe(0);
  });

  it('says the project, the agent, who asks and what for', () => {
    expect(item('chat:req-1')).toMatchObject({
      source: 'here',
      kind: 'approval',
      action: 'Run a command',
      // The tower knows the agent and the folder of the pack task.
      agent: 'codex',
      project: { name: 'wt', path: '/work/app/wt' },
      origin: 'this chat “Ship the layout” · Pack task t3',
      text: 'npm test',
      verbatim: true,
    });
    expect(item('session:claude:gate')).toMatchObject({
      source: 'app',
      kind: 'question',
      action: 'Answer a question',
      agent: 'claude',
      project: { name: 'site', path: '/work/site' },
      origin: 'chat “Gate verdict retries”',
      text: 'Retry on 502 too, or only on timeouts?',
      verbatim: false,
    });
    expect(item('session:codex:flaky')).toMatchObject({ source: 'tower', origin: 'session “Fix flaky tower test”' });
    expect(item('tower:hook:abc')).toMatchObject({
      source: 'tower',
      action: 'Permission request',
      origin: 'session “Ship it”',
      text: 'Bash\nnpm publish',
    });
    expect(item('tower:draft-1')).toMatchObject({
      action: 'Proposed message',
      origin: 'codex / flaky',
      text: 'Go on.',
    });
  });

  it('offers the answers each source takes', () => {
    const labels = (key: string, from = input) => item(key, from).choices.map((choice) => choice.label);
    // The open chat's approval: under the tower's id where the tower lists it (the tower checks the
    // turn), else by the chat's own command.
    expect(item('chat:req-1').choices).toEqual([
      { label: 'Approve', primary: true, decision: { via: 'tower', id: 'turn:4:req-1', decision: 'approve' } },
      { label: 'Deny', decision: { via: 'tower', id: 'turn:4:req-1', decision: 'deny' } },
    ]);
    expect(item('chat:req-1', { ...input, tower: undefined }).choices.map((choice) => choice.decision)).toEqual([
      { via: 'chat', id: 'req-1', decision: 'approve' },
      { via: 'chat', id: 'req-1', decision: 'deny' },
    ]);
    expect(item('chat:req-1').open).toEqual({ to: 'chat' });
    // A question with choices is answered in the chat.
    expect(labels('chat:req-2')).toEqual([]);
    expect(item('chat:req-2')).toMatchObject({ kind: 'question', text: 'Which branch?', open: { to: 'chat' } });
    // A hook's question, through the tower.
    expect(item('tower:hook:abc').choices.map((choice) => choice.decision)).toEqual([
      { via: 'tower', id: 'hook:abc', decision: 'approve' },
      { via: 'tower', id: 'hook:abc', decision: 'deny' },
    ]);
    // A dialog of the agent's own: nothing to press here.
    expect(labels('tower:native:["gemini","native"]')).toEqual([]);
    expect(item('tower:native:["gemini","native"]').note).toBe(
      'Answer it in gemini: its own dialog holds the question.',
    );
    expect(labels('tower:draft-1')).toEqual(['Send to session', 'Dismiss']);
    // A session that asks takes a reply where its agent can be sent to; this app's chat opens as a chat.
    expect(item('session:claude:gate').reply).toEqual({ session: own[1], sandboxes: ['read-only'] });
    expect(item('session:claude:gate').open).toEqual({ to: 'own', session: own[1] });
    expect(item('session:codex:flaky').open).toMatchObject({
      to: 'sessions',
      session: { source: 'codex', id: 'flaky' },
    });
    expect(item('session:codex:flaky', { ...input, senders: [] }).reply).toBeUndefined();
    // Without a tower a hook's question is answered at its own endpoint, and one no hook holds is not.
    const bare = { ...input, tower: undefined };
    expect(item('session:codex:hooked:abc', bare).choices.map((choice) => choice.decision)).toEqual([
      { via: 'ask', id: 'abc', behavior: 'allow' },
      { via: 'ask', id: 'abc', behavior: 'deny' },
    ]);
    expect(item('session:codex:hooked:abc', bare).reply).toBeUndefined();
    expect(labels('session:gemini:native', bare)).toEqual([]);
    expect(item('session:gemini:native', bare).note).toContain('Answer it in gemini');
  });

  it('knows since when each waits', () => {
    const since = (key: string) => item(key).since;
    expect(since('chat:req-1')).toBe(now - 2 * MIN);
    expect(since('chat:req-2')).toBeUndefined();
    expect(since('tower:hook:abc')).toBe(now - 5 * MIN);
    expect(since('tower:native:["gemini","native"]')).toBe(now - 40 * MIN);
    expect(since('tower:draft-1')).toBe(now - 10_000);
    expect(since('session:codex:flaky')).toBe(now - 3 * 60 * MIN);
  });
});

describe('needsItems, where answers could reach the wrong request', () => {
  const bare = { ...input, tower: undefined };

  it('keys a hook card by its question: the next question of the session is another card', () => {
    const first = needsItems(bare).find((one) => one.key.startsWith('session:codex:hooked'))!;
    const next: PendingAsk = { ...asks[0]!, id: 'def', preview: 'npm version patch', at: now - MIN };
    const after = needsItems({ ...bare, asks: [next] }).find((one) => one.key.startsWith('session:codex:hooked'))!;
    expect(first.key).toBe('session:codex:hooked:abc');
    expect(after.key).toBe('session:codex:hooked:def');
    expect(after.choices[0]!.decision).toEqual({ via: 'ask', id: 'def', behavior: 'allow' });
    // A session that waits on no hook keeps its key.
    expect(needsItems({ ...bare, asks: [] }).map((one) => one.key)).toContain('session:codex:hooked');
  });

  it('answers a hook only for the local session of its agent, and not when two rows could be it', () => {
    const cloud = session('hooked', { source: 'codexCloud', agent: 'codex', where: 'cloud', waitingFor: 'approval' });
    const both = needsItems({ ...bare, sessions: [...sessions, cloud] });
    const choices = (source: string) =>
      both.find((one) => one.key.startsWith(`session:${source}:hooked`))!.choices.map((c) => c.decision);
    expect(choices('codex')).toEqual([
      { via: 'ask', id: 'abc', behavior: 'allow' },
      { via: 'ask', id: 'abc', behavior: 'deny' },
    ]);
    // The cloud row with the same agent and id is not the one the hook runs beside.
    expect(choices('codexCloud')).toEqual([]);
    expect(both.find((one) => one.key === 'session:codexCloud:hooked')!.note).toContain('Answer it in codex');
    // Two local rows with the same agent and id: which one asks is not known, so neither answers.
    const twin = session('hooked', { source: 'codexLive', agent: 'codex', waitingFor: 'approval' });
    const twins = needsItems({ ...bare, sessions: [...sessions, twin] }).filter((one) => one.key.includes(':hooked'));
    expect(twins.map((one) => one.key)).toEqual(['session:codex:hooked']);
    expect(twins.flatMap((one) => one.choices)).toEqual([]);
  });

  it('keeps an own chat of another store with the same agent and id, and answers neither', () => {
    // Every agent's list has chat A; this app's own list has automated chat B in another store.
    const a = session('hooked', { source: 'codex', agent: 'codex', title: 'Chat A', cwd: '/work/a' });
    const b = session('hooked', {
      source: 'codexLive',
      agent: 'codex',
      title: 'Chat B',
      cwd: '/work/b',
      automated: true,
      waitingFor: 'approval',
    });
    expect(needsSessions([a], [b])).toEqual([a, b]);
    const items = needsItems({ ...bare, sessions: [a], own: [b] }).filter((one) => one.key.includes(':hooked'));
    // B asks under its own title and project, and the hook's question is not answered from here.
    expect(items.map((one) => [one.key, one.origin, one.project?.dir])).toEqual([
      ['session:codexLive:hooked', 'chat “Chat B”', '/work/b'],
    ]);
    expect(items[0]!.choices).toEqual([]);
  });

  it('offers no Open action for a session of every agent’s list until this app’s chats are read', () => {
    const early = needsItems({ ...input, own: [], ownKnown: false });
    // It may be one of this app's chats: neither "Open session" nor "Open chat" yet.
    expect(early.find((one) => one.key === 'session:claude:gate')!.open).toBeUndefined();
    expect(early.find((one) => one.key === 'tower:hook:abc')!.open).toBeUndefined();
    // A tower item no listed session is for still opens All sessions; the open chat's own still open it.
    expect(early.find((one) => one.key === 'tower:draft-1')!.open).toEqual({ to: 'sessions' });
    expect(early.find((one) => one.key === 'chat:req-1')!.open).toEqual({ to: 'chat' });
    // Once they are read, it opens as the chat it is.
    expect(item('session:claude:gate').open).toEqual({ to: 'own', session: own[1] });
  });

  it('answers an approval of the open chat under the turn that asked, when the tower names it', () => {
    // The tower lists the request of turn 4: the answer goes under that id, which the tower
    // checks against the running turn, so a late click cannot answer turn 5's request of the same id.
    expect(item('chat:req-1').choices[0]!.decision).toEqual({ via: 'tower', id: 'turn:4:req-1', decision: 'approve' });
    // A tower item of another turn is not this request's.
    const stale = needsItems({ ...input, chat: { ...input.chat!, turnId: 5 } }).find(
      (one) => one.key === 'chat:req-1',
    )!;
    expect(stale.choices[0]!.decision).toEqual({ via: 'chat', id: 'req-1', decision: 'approve' });
  });

  it('lists and counts this app’s chats that every agent’s sessions leave out, each once', () => {
    // An automated chat of this app: not among every agent's sessions.
    const cron = asking('cron', { title: 'Nightly triage', automated: true });
    const withCron = { ...input, own: [...own, cron] };
    expect(needsItems(withCron).map((one) => one.key)).toContain('session:claude:cron');
    expect(needsItems(withCron)).toHaveLength(count(withCron));
    expect(count(withCron)).toBe(count(input) + 1);
    // Where both have a row, every agent's sessions' wins: the own row that says otherwise is not read.
    const stale = { ...input, own: [session('open'), session('gate', { title: 'Gate verdict retries' })] };
    expect(needsItems(stale).map((one) => one.key)).toContain('session:claude:gate');
    expect(needsSessions(sessions, [session('gate')]).filter((one) => one.id === 'gate')).toEqual([own[1]]);
  });

  it('shows the worker that asks in --delegate without a tower, in its worktree', () => {
    const pack = {
      lead: 'claude',
      tasks: [{ id: 't3', agent: 'codex', cwd: '/work/app/.genaicode/worktrees/t3' }],
    };
    const delegated = { ...bare, chat: { ...bare.chat!, agent: 'claude', pack } };
    expect(item('chat:req-1', delegated)).toMatchObject({
      agent: 'codex',
      project: { name: 't3', path: '/work/app/.genaicode/worktrees/t3' },
      origin: 'this chat “Ship the layout” · Pack task t3',
    });
    // An approval that names no task is the lead's.
    expect(item('chat:req-2', delegated)).toMatchObject({
      agent: 'claude',
      project: { name: 'app', path: '/work/app' },
      origin: 'this chat “Ship the layout” · Pack lead',
    });
    // Outside --delegate, the chat's own.
    expect(item('chat:req-1', bare)).toMatchObject({ agent: 'claude', origin: 'this chat “Ship the layout”' });
  });

  it('escapes the folder for display and keeps the path as it is', () => {
    // A right-to-left override and a bell in the folder's name.
    const odd = '/work/\u202eppa\u0007';
    const from = { ...bare, chat: { ...bare.chat!, cwd: odd } };
    expect(item('chat:req-2', from).project).toEqual({
      name: '\\u202eppa\\u0007',
      path: '/work/\\u202eppa\\u0007',
      dir: odd,
    });
  });
});

it('says how long something has waited', () => {
  expect(waited(now - 10_000, now)).toBe('just now');
  expect(waited(now - 40 * MIN, now)).toBe('40m ago');
  expect(waited(now - 3 * 60 * MIN, now)).toBe('3h ago');
  expect(waited(now - 3 * 24 * 60 * MIN, now)).toBe('3d ago');
  expect(waited(undefined, now)).toBe('');
});

it('groups the queue under filters, each with its count', () => {
  const items = needsItems(input);
  expect(needsFilters(items, 'Ship the layout')).toEqual([
    { filter: 'all', label: 'All', count: 7 },
    { filter: 'here', label: 'Ship the layout', count: 2 },
    { filter: 'app', label: 'This app’s chats', count: 1 },
    { filter: 'tower', label: 'Tower: other agents’ sessions', count: 4 },
    { filter: 'approvals', label: 'Approvals', count: 4 },
    { filter: 'questions', label: 'Questions', count: 3 },
  ]);
  expect(needsFilters([])[1]).toEqual({ filter: 'here', label: 'This chat', count: 0 });
  expect(items.filter((one) => underFilter(one, 'app')).map((one) => one.key)).toEqual(['session:claude:gate']);
});

it('drops what was answered from here from a listing read before, until it is read again', () => {
  const hooked = sessions.find((one) => one.id === 'hooked')!;
  const next: PendingAsk = { ...asks[0]!, id: 'def', at: now - MIN };
  // The tower answered `abc`: the card does not come back from the listing read before.
  const after = withoutAnswered(sessions, asks, new Set(['abc']));
  expect(after.asks).toEqual([]);
  expect(after.sessions.find((one) => one.id === 'hooked')).toMatchObject({ state: 'active', waitingFor: undefined });
  const bare = { ...input, tower: undefined, sessions: after.sessions, asks: after.asks };
  expect(needsItems(bare).some((one) => one.key.includes(':hooked'))).toBe(false);
  expect(count(bare)).toBe(count({ ...input, tower: undefined }) - 1);
  // Another question of the same session still waits: so does the session.
  const more = withoutAnswered(sessions, [...asks, next], new Set(['abc']));
  expect(more.asks).toEqual([next]);
  expect(more.sessions.find((one) => one.id === 'hooked')).toBe(hooked);
  // A cloud row with the same agent and id is not the session the hook ran beside.
  const cloud = session('hooked', { source: 'codexCloud', agent: 'codex', where: 'cloud', waitingFor: 'approval' });
  expect(withoutAnswered([cloud], asks, new Set(['abc'])).sessions[0]).toBe(cloud);
  // Nothing answered: the listing as it is.
  expect(withoutAnswered(sessions, asks, new Set()).sessions).toBe(sessions);
});

it('drops what was answered from here from an own chat every agent’s list leaves out, too', () => {
  // An automated Codex chat of this app: only the app's own listing has it.
  const bot = session('bot', { source: 'codex', agent: 'codex', waitingFor: 'approval', title: 'Nightly bump' });
  const ask: PendingAsk = { ...asks[0]!, id: 'bot-1', session: 'bot' };
  const before = { sessions: [], own: [bot], asks: [ask], senders: input.senders, now };
  expect(needsItems(before).map((one) => one.key)).toEqual(['session:codex:bot:bot-1']);
  expect(count(before)).toBe(1);
  // Without the question alone, the row still waits on a tool: a card that sends you to codex.
  expect(needsItems({ ...before, asks: [] })).toHaveLength(1);
  const after = chatsWithoutAnswered([bot], [], [ask], new Set(['bot-1']));
  expect(after.own[0]).toMatchObject({ state: 'active', waitingFor: undefined });
  expect(after.asks).toEqual([]);
  // Neither a card that says to answer it elsewhere, nor a count.
  const shown = { ...before, own: after.own, sessions: after.sessions, asks: after.asks };
  expect(needsItems(shown)).toEqual([]);
  expect(count(shown)).toBe(0);
});
