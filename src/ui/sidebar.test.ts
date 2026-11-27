import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../agents/sessions/group.js';
import {
  chatProjects,
  isOpenChat,
  chatTitle,
  escapeAction,
  HOME_FOLDER,
  liveGlyph,
  needsYou,
  OPEN_CHAT_SOURCE,
  otherSessions,
  quotaRows,
  sessionGlyph,
  sessionKey,
  startsCollapsed,
  withOpenChat,
} from './sidebar.js';

const now = Date.parse('2026-11-25T10:00:00Z');
const chat = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id,
  where: 'local',
  cwd: '/work/app',
  title: `Chat ${id}`,
  updatedAt: now - 60_000,
  ...patch,
});

describe('chatProjects', () => {
  it('groups chats by directory, newest project and newest chat first', () => {
    const projects = chatProjects([
      chat('a', { updatedAt: now - 5_000 }),
      chat('b', { cwd: '/work/site/', updatedAt: now - 1_000 }),
      chat('c', { updatedAt: now - 2_000 }),
      chat('d', { cwd: '/work/site', updatedAt: now - 9_000 }),
    ]);
    expect(projects.map((project) => [project.name, project.path, project.chats.map((one) => one.id)])).toEqual([
      ['site', '/work/site', ['b', 'd']],
      ['app', '/work/app', ['c', 'a']],
    ]);
  });

  it('puts chats without a folder, and those in the app’s own home, under "Home folder"', () => {
    const projects = chatProjects(
      [chat('a', { cwd: undefined }), chat('b', { cwd: '/home/me/.genaicode/home' }), chat('c')],
      { home: '/home/me/.genaicode/home/' },
    );
    const home = projects.find((project) => project.key === HOME_FOLDER)!;
    expect(home.name).toBe('Home folder');
    expect(home.path).toBe('/home/me/.genaicode/home');
    expect(home.chats.map((one) => one.id).sort()).toEqual(['a', 'b']);
    expect(projects).toHaveLength(2);
  });

  it('leaves archived chats out', () => {
    expect(chatProjects([chat('a', { archived: true })])).toEqual([]);
  });
});

describe('withOpenChat', () => {
  const open = { id: 'new', agent: 'codex', cwd: '/work/app', title: 'Fix the build', updatedAt: now };

  it('adds the open chat while no store lists it', () => {
    const rows = withOpenChat([chat('a')], open);
    expect(rows[0]).toMatchObject({ source: OPEN_CHAT_SOURCE, id: 'new', agent: 'codex', title: 'Fix the build' });
    expect(rows).toHaveLength(2);
    // Before the agent named its session there is no id yet.
    expect(withOpenChat([], { ...open, id: undefined })[0]).toMatchObject({ source: OPEN_CHAT_SOURCE, id: '' });
  });

  it('keeps one row for a listed chat, with the title and time of the open one', () => {
    const rows = withOpenChat([chat('new', { title: 'old title', updatedAt: now - 90_000 }), chat('a')], open);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'claude', id: 'new', title: 'Fix the build', updatedAt: now });
  });

  it('tells the open chat from a session with the same id in another store', () => {
    const twins = [chat('new', { source: 'codex', title: 'Mine' }), chat('new', { title: 'Not mine' })];
    const rows = withOpenChat(twins, { ...open, source: 'codex' });
    expect(rows.map((one) => one.title)).toEqual(['Fix the build', 'Not mine']);
    expect(rows.filter((one) => isOpenChat(one, { id: 'new', source: 'codex' })).map(sessionKey)).toEqual([
      'codex:new',
    ]);
    // Listed only in the other store: the open chat still gets its own row.
    const added = withOpenChat([twins[1]!], { ...open, source: 'codex' });
    expect(added.map((one) => one.source)).toEqual([OPEN_CHAT_SOURCE, 'claude']);
    expect(added.filter((one) => isOpenChat(one, { id: 'new', source: 'codex' }))).toEqual([added[0]]);
  });

  it('changes nothing without an open chat', () => {
    expect(withOpenChat([chat('a')], undefined).map((one) => one.id)).toEqual(['a']);
  });
});

describe('glyphs', () => {
  it('reads a listed session: asking beats running, an ended turn is done, the rest is idle', () => {
    expect(sessionGlyph(chat('a', { state: 'active' }), now)).toBe('run');
    expect(sessionGlyph(chat('a', { state: 'waiting', waitingFor: 'approval' }), now)).toBe('ask');
    expect(sessionGlyph(chat('a', { state: 'waiting', ending: 'question' }), now)).toBe('ask');
    expect(sessionGlyph(chat('a', { state: 'waiting' }), now)).toBe('ok');
    expect(sessionGlyph(chat('a', { state: 'unfinished' }), now)).toBe('idle');
    expect(sessionGlyph(chat('a'), now)).toBe('idle');
  });

  it('reads the open chat from its live state', () => {
    expect(liveGlyph({ status: 'running', approvals: 1, turns: 1 })).toBe('ask');
    expect(liveGlyph({ status: 'running', approvals: 0, turns: 1 })).toBe('run');
    expect(liveGlyph({ status: 'idle', approvals: 0, turns: 2, failed: true })).toBe('err');
    expect(liveGlyph({ status: 'idle', approvals: 0, turns: 2 })).toBe('ok');
    expect(liveGlyph({ status: 'idle', approvals: 0, turns: 0 })).toBeUndefined();
  });
});

it('titles a row with the title, else a prompt, on one line', () => {
  expect(chatTitle(chat('a', { title: 'First\nsecond' }))).toBe('First');
  expect(chatTitle(chat('a', { title: undefined, firstPrompt: 'Add CSV export' }))).toBe('Add CSV export');
  expect(
    chatTitle(
      chat('a', {
        firstPrompt: 'Which driver? Attached files (read them from disk): - /project/.genaicode/uploads/123.png',
        title: undefined,
      }),
    ),
  ).toBe('Which driver?');
  expect(chatTitle(chat('', { title: undefined }))).toBe('New chat');
});

it('titles a taken-over chat from what the person wrote, not the recap in front of it', () => {
  const recap =
    "You are taking over a conversation that the user had with another coding agent (claude) in this workspace. Recap of what was said (latest last): User: Add CSV export claude: Done. The user's new message follows. --- Add a header row";
  expect(chatTitle(chat('a', { title: recap }))).toBe('Add a header row');
  const cut = recap.slice(0, 100);
  expect(chatTitle(chat('a', { title: cut, firstPrompt: cut, lastPrompt: 'Make it bold' }))).toBe('Make it bold');
});

it('lists the other agents’ sessions: not this app’s, asking first, then the latest, capped', () => {
  const own = [chat('mine')];
  const all = [
    chat('mine'),
    // The same session read through another source is still this app's.
    chat('mine', { source: 'claude-app' }),
    chat('old', { agent: 'codex', source: 'codex', updatedAt: now - 9_000_000 }),
    chat('new', { agent: 'gemini', source: 'gemini', updatedAt: now - 1_000 }),
    chat('asks', {
      agent: 'codex',
      source: 'codex',
      state: 'waiting',
      waitingFor: 'approval',
      updatedAt: now - 5_000_000,
    }),
    chat('gone', { archived: true }),
  ];
  const { shown, total } = otherSessions(all, own, 2, now);
  expect(shown.map((one) => one.id)).toEqual(['asks', 'new']);
  expect(total).toBe(3);
});

it('tells another agent’s session from this app’s chat with the same id by its store', () => {
  const own = [chat('shared'), withOpenChat([], { id: 'open', agent: 'gemini', cwd: '/work', updatedAt: now })[0]!];
  const all = [
    chat('shared'),
    chat('shared', { agent: 'codex', source: 'codex' }),
    // The open chat in its agent's store, and a session of another agent with its id.
    chat('open', { agent: 'gemini', source: 'gemini' }),
    chat('open', { agent: 'codex', source: 'codex' }),
  ];
  expect(otherSessions(all, own, 9, now).shown.map(sessionKey)).toEqual(['codex:shared', 'codex:open']);
});

it('counts what needs you across projects and in the open chat, the open session once', () => {
  const sessions = [
    chat('open', { state: 'waiting', waitingFor: 'approval' }),
    chat('other', { state: 'waiting', ending: 'question', updatedAt: now - 3_600_000 }),
    chat('ended', { state: 'waiting' }),
  ];
  const tower = [{ id: 'draft-1' }, { id: 'draft-2' }, { id: 'draft-3' }];
  expect(needsYou({ approvals: 2, tower, sessions, open: { id: 'open', source: 'claude' }, now })).toEqual({
    total: 6,
    here: 2,
    sessions: 1,
    title: 'Needs you: 6 across all projects, 2 in this chat',
  });
  expect(needsYou({ approvals: 0, now }).title).toBe('Nothing needs you now');
});

it('counts a request once when the tower, the open chat and the sessions all list it', () => {
  const sessions = [
    chat('open', { state: 'waiting', waitingFor: 'approval' }),
    // Both in the tower: one by what its agent's store says, one by a hook that waits with two questions.
    chat('native', { state: 'waiting', waitingFor: 'approval' }),
    chat('hooked', { state: 'waiting', waitingFor: 'approval' }),
    // Not in the tower: it asks with a question.
    chat('asks', { state: 'waiting', ending: 'question', updatedAt: now - 3_600_000 }),
  ];
  const tower = [
    // The open chat's own approval, as `TowerInbox.view()` repeats it.
    { id: 'turn:1:approval-1' },
    { id: 'native:["claude","native"]', sessionId: 'native' },
    { id: 'hook:1', sessionId: 'hooked' },
    { id: 'hook:2', sessionId: 'hooked' },
    { id: 'draft-1' },
  ];
  expect(needsYou({ approvals: 1, tower, sessions, open: { id: 'open', source: 'claude' }, now })).toMatchObject({
    // 1 here, 4 in the tower besides it, 1 session the tower does not know.
    total: 6,
    here: 1,
    sessions: 1,
  });
  // The tower's view of the turn alone adds nothing to the chat's own count.
  expect(needsYou({ approvals: 1, tower: [{ id: 'turn:1:approval-1' }], now }).total).toBe(1);
});

it('keeps sessions of two stores apart when they share an id', () => {
  const question = { state: 'waiting', ending: 'question', updatedAt: now - 3_600_000 } as const;
  const sessions = [
    chat('same', { state: 'waiting', waitingFor: 'approval' }),
    // Another store, the same id, another request: the tower's item is not for it.
    chat('same', { source: 'codex', agent: 'codex', ...question }),
  ];
  const native = { id: 'native:["claude","same"]', agent: 'claude', sessionId: 'same', source: 'claude' };
  expect(needsYou({ approvals: 0, tower: [native], sessions, now })).toMatchObject({ total: 2, sessions: 1 });
  // A hook's question names the agent, not the store.
  const hook = { id: 'hook:1', agent: 'claude', sessionId: 'same' };
  expect(needsYou({ approvals: 0, tower: [hook], sessions, now })).toMatchObject({ total: 2, sessions: 1 });
  expect(needsYou({ approvals: 0, tower: [{ ...hook, agent: 'gemini' }], sessions, now }).total).toBe(3);
  // The open chat is the session of its agent's store; the other store's one still asks.
  expect(needsYou({ approvals: 1, sessions, open: { id: 'same', source: 'claude' }, now })).toMatchObject({
    total: 2,
    sessions: 1,
  });
  expect(needsYou({ approvals: 1, sessions, open: { id: 'same', source: 'codex' }, now }).sessions).toBe(1);
  // No store known for the open chat: the id alone, as before.
  expect(needsYou({ approvals: 1, sessions, open: { id: 'same' }, now }).sessions).toBe(0);
});

describe('quotaRows', () => {
  it('shows each agent’s worst window, the closest to its limit first', () => {
    const rows = quotaRows(
      [
        { agent: 'claude', window: '5h', status: 'ok', usedPercent: 62 },
        { agent: 'claude', window: '7d', status: 'ok', usedPercent: 12 },
        { agent: 'gemini', window: 'quota', status: 'exceeded', resetsAt: now + 6 * 3_600_000 },
        // The same account as codex.
        { agent: 'codexLive', window: '5h', status: 'warning', usedPercent: 88.4 },
        // Rolled over since it was reported.
        { agent: 'cursor', window: '5h', status: 'exceeded', resetsAt: now - 1 },
      ],
      ['agy', 'codexLive'],
      now,
    );
    expect(rows.map((row) => [row.agent, row.text, row.level])).toEqual([
      ['gemini', 'out · 6h', 'exceeded'],
      ['codex', '88% · 5h', 'warning'],
      ['claude', '62% · 5h', 'ok'],
      ['agy', 'no limits', 'ok'],
      ['cursor', 'no limits', 'ok'],
    ]);
    expect(rows[0]!.percent).toBe(100);
    expect(rows[3]!.percent).toBeUndefined();
  });
});

describe('escapeAction', () => {
  // Menus and the viewer come before this: `<Shell>`'s test presses the key on the live handlers.
  it('leaves the open page before it stops anything', () => {
    expect(escapeAction({ page: true, inComposer: true, running: true })).toBe('page');
    expect(escapeAction({ page: true, running: true })).toBe('page');
  });

  it('stops a running turn only when nothing is open and the focus is in the message field', () => {
    expect(escapeAction({ inComposer: true, running: true })).toBe('stop');
    expect(escapeAction({ running: true })).toBeUndefined();
    expect(escapeAction({ inComposer: true })).toBeUndefined();
  });
});

it('starts as the rail below 980 px unless the person chose', () => {
  expect(startsCollapsed(null, 900)).toBe(true);
  expect(startsCollapsed(null, 980)).toBe(false);
  expect(startsCollapsed('0', 900)).toBe(false);
  expect(startsCollapsed('1', 1440)).toBe(true);
});
