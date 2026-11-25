import { describe, expect, it } from 'vitest';
import type { PendingAsk } from '../agents/sessions/answer.js';
import type { TowerItem } from '../agents/sessions/tower.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import { needsFilters, needsItems, underFilter, waited, type NeedsInput } from './needs-you.js';
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
    sessions: from.sessions,
    open: { id: from.chat?.id, source: from.chat?.source },
    now,
  }).total;
const item = (key: string, from = input) => needsItems(from).find((one) => one.key === key)!;

describe('needsItems', () => {
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
      'session:codex:hooked',
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
    // The open chat's approval, by the chat's own command.
    expect(item('chat:req-1').choices).toEqual([
      { label: 'Approve', primary: true, decision: { via: 'chat', id: 'req-1', decision: 'approve' } },
      { label: 'Deny', decision: { via: 'chat', id: 'req-1', decision: 'deny' } },
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
    expect(item('session:codex:flaky').open).toEqual({ to: 'sessions' });
    expect(item('session:codex:flaky', { ...input, senders: [] }).reply).toBeUndefined();
    // Without a tower a hook's question is answered at its own endpoint, and one no hook holds is not.
    const bare = { ...input, tower: undefined };
    expect(item('session:codex:hooked', bare).choices.map((choice) => choice.decision)).toEqual([
      { via: 'ask', id: 'abc', behavior: 'allow' },
      { via: 'ask', id: 'abc', behavior: 'deny' },
    ]);
    expect(item('session:codex:hooked', bare).reply).toBeUndefined();
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
