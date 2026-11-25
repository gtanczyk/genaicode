import { describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../agents/sessions/group.js';
import {
  paletteCommands,
  paletteItems,
  paletteMove,
  paletteProject,
  paletteTerms,
  type PaletteSource,
} from './palette.js';
import { OPEN_CHAT_SOURCE } from './sidebar.js';

const now = Date.parse('2026-11-25T10:00:00Z');
const session = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id,
  where: 'local',
  cwd: '/work/app',
  title: `Chat ${id}`,
  state: 'waiting',
  updatedAt: now,
  ...patch,
});

const command = (id: string, label: string, keywords?: string) => ({ id, label, keywords, run: vi.fn() });

const source: PaletteSource = {
  chats: [
    session('cart', { title: 'Fix the cart total', updatedAt: now - 3000 }),
    session('cart-site', { title: 'Fix the cart total', cwd: '/work/site/', updatedAt: now - 1000 }),
    session('deploy', {
      title: 'Deploy script',
      firstPrompt: 'why does the settings page crash',
      updatedAt: now - 2000,
    }),
    session('home', { title: 'Loose notes', cwd: '/home/me/.genaicode/home', updatedAt: now - 4000 }),
    session('old', { title: 'Put away', archived: true }),
  ],
  sessions: [
    session('theirs', {
      source: 'codex',
      agent: 'codex',
      title: 'Sourdough schedule',
      cwd: '/work/bakery',
      updatedAt: now,
    }),
    session('prompted', {
      source: 'gemini',
      agent: 'gemini',
      title: 'Untitled',
      lastPrompt: 'tidy the cart tests',
      updatedAt: now - 500,
    }),
  ],
  commands: [command('new-chat', 'New chat'), command('settings', 'Settings: Agents', 'preferences')],
  home: '/home/me/.genaicode/home',
};

const titles = (query: string, from = source) =>
  paletteItems(from, query).map(
    (item) => `${item.kind}:${item.title}${item.kind === 'command' ? '' : `@${item.project}`}`,
  );

describe('paletteItems', () => {
  it('lists the chats newest first, then the other sessions, then the commands when nothing is typed', () => {
    expect(titles('')).toEqual([
      'chat:Fix the cart total@site',
      'chat:Deploy script@app',
      'chat:Fix the cart total@app',
      'chat:Loose notes@Home folder',
      'session:Sourdough schedule@bakery',
      'session:Untitled@app',
      'command:New chat',
      'command:Settings: Agents',
    ]);
    expect(titles('   ')).toEqual(titles(''));
  });

  it('leaves out the archived, and has the open chat also before a store lists it', () => {
    expect(titles('put away')).toEqual([]);
    const open = session('', { source: OPEN_CHAT_SOURCE, title: 'Just started', updatedAt: now + 1 });
    const found = paletteItems({ ...source, chats: [open, ...source.chats] }, '');
    expect(found[0]).toMatchObject({ kind: 'chat', title: 'Just started', session: open });
    expect(found).toHaveLength(titles('').length + 1);
  });

  it('names project and agent on every result, as titles repeat across projects', () => {
    const found = paletteItems(source, 'cart total');
    expect(found.map((item) => (item.kind === 'command' ? '' : `${item.project} ${item.agent}`))).toEqual([
      'site claude',
      'app claude',
    ]);
  });

  it('matches the title before the project or agent, and those before a prompt', () => {
    // "cart": two titles (the newer first), then the session whose last prompt has it.
    expect(titles('cart')).toEqual([
      'chat:Fix the cart total@site',
      'chat:Fix the cart total@app',
      'session:Untitled@app',
    ]);
    // "settings": the command by its label, then the chat whose first prompt has it.
    expect(titles('settings')).toEqual(['command:Settings: Agents', 'chat:Deploy script@app']);
    // By project and by agent.
    expect(titles('bakery')).toEqual(['session:Sourdough schedule@bakery']);
    expect(titles('gemini')).toEqual(['session:Untitled@app']);
    expect(titles('home folder')).toEqual(['chat:Loose notes@Home folder']);
  });

  it('wants every word, in any order and any case, in some field', () => {
    expect(titles('SITE cart')).toEqual(['chat:Fix the cart total@site']);
    expect(titles('cart nowhere')).toEqual([]);
    expect(titles('codex sour')).toEqual(['session:Sourdough schedule@bakery']);
  });

  it('ranks the start of the title over the start of a word over the middle of one', () => {
    const chats = [
      session('middle', { title: 'Redeploy later', updatedAt: now }),
      session('word', { title: 'The deploy script', updatedAt: now - 1 }),
      session('start', { title: 'Deploy now', updatedAt: now - 2 }),
    ];
    expect(paletteItems({ chats, sessions: [], commands: [] }, 'deploy').map((item) => item.title)).toEqual([
      'Deploy now',
      'The deploy script',
      'Redeploy later',
    ]);
  });

  it('puts a command before a chat that matches as well, and finds it by its other words', () => {
    const chats = [session('n', { title: 'New chat about tests' })];
    expect(titles('new chat', { chats, sessions: [], commands: source.commands })).toEqual([
      'command:New chat',
      'chat:New chat about tests@app',
    ]);
    expect(titles('preferences')).toEqual(['command:Settings: Agents']);
  });

  it('lists a session once and stops at the limit', () => {
    const twice = { ...source, sessions: [...source.sessions, source.chats[0]!] };
    expect(titles('', twice)).toEqual(titles(''));
    expect(paletteItems(source, '', 3)).toHaveLength(3);
    expect(paletteItems(source, 'cart', 1).map((item) => item.key)).toEqual(['chat:claude:cart-site']);
  });
});

describe('paletteProject and paletteTerms', () => {
  it('names the folder, or the home folder', () => {
    expect(paletteProject({ cwd: '/work/app/' })).toBe('app');
    expect(paletteProject({ cwd: 'C:\\work\\site' })).toBe('site');
    expect(paletteProject({})).toBe('Home folder');
    expect(paletteProject({ cwd: '/home/me/' }, '/home/me')).toBe('Home folder');
    expect(paletteProject({ cwd: '/home/me' })).toBe('me');
  });

  it('splits what was typed into lower-case words', () => {
    expect(paletteTerms('  Cart   TOTAL ')).toEqual(['cart', 'total']);
    expect(paletteTerms('')).toEqual([]);
  });
});

describe('paletteMove', () => {
  it('moves one row with the arrows, around the ends', () => {
    expect(paletteMove('ArrowDown', 0, 3)).toBe(1);
    expect(paletteMove('ArrowDown', 2, 3)).toBe(0);
    expect(paletteMove('ArrowUp', 0, 3)).toBe(2);
    expect(paletteMove('ArrowUp', 2, 3)).toBe(1);
  });

  it('goes to the ends with Home and End, a page with PageUp and PageDown', () => {
    expect(paletteMove('Home', 2, 3)).toBe(0);
    expect(paletteMove('End', 0, 3)).toBe(2);
    expect(paletteMove('PageDown', 1, 30)).toBe(9);
    expect(paletteMove('PageDown', 25, 30)).toBe(29);
    expect(paletteMove('PageUp', 3, 30)).toBe(0);
  });

  it('leaves other keys, and an empty list, alone', () => {
    expect(paletteMove('a', 0, 3)).toBeUndefined();
    expect(paletteMove('Enter', 0, 3)).toBeUndefined();
    expect(paletteMove('ArrowDown', 0, 0)).toBeUndefined();
  });
});

describe('paletteCommands', () => {
  const all = () => ({
    onNewChat: vi.fn(),
    onNeedsYou: vi.fn(),
    onAllSessions: vi.fn(),
    onAllChats: vi.fn(),
    settings: [
      { label: 'Agents', onSelect: vi.fn() },
      { label: 'Project team', onSelect: vi.fn() },
    ],
    onWhatsNew: vi.fn(),
    onCommands: vi.fn(),
    onToggleSidebar: vi.fn(),
  });

  it('lists what the window has, with the keys the sidebar shows', () => {
    const actions = all();
    const commands = paletteCommands({ ...actions, needs: 2 });
    expect(commands.map((one) => `${one.label}${one.shortcut ? ` ${one.shortcut}` : ''}`)).toEqual([
      'New chat ⌘N',
      'Needs you (2)',
      'All sessions',
      'All chats',
      'Settings: Agents',
      'Settings: Project team',
      'Collapse sidebar ⌘B',
      'What’s new',
      'Commands and keys',
    ]);
    expect(new Set(commands.map((one) => one.id)).size).toBe(commands.length);
    for (const one of commands) one.run();
    expect(actions.onNewChat).toHaveBeenCalledTimes(1);
    expect(actions.onNeedsYou).toHaveBeenCalledTimes(1);
    expect(actions.onAllSessions).toHaveBeenCalledTimes(1);
    expect(actions.onAllChats).toHaveBeenCalledTimes(1);
    expect(actions.settings[0]!.onSelect).toHaveBeenCalledTimes(1);
    expect(actions.settings[1]!.onSelect).toHaveBeenCalledTimes(1);
    expect(actions.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(actions.onWhatsNew).toHaveBeenCalledTimes(1);
    expect(actions.onCommands).toHaveBeenCalledTimes(1);
  });

  it('has only New chat and Needs you in a window with nothing else', () => {
    const commands = paletteCommands({ onNewChat: vi.fn(), onNeedsYou: vi.fn(), mac: false });
    expect(commands.map((one) => `${one.label} ${one.shortcut ?? ''}`.trim())).toEqual([
      'New chat Ctrl+N',
      'Needs you',
    ]);
  });

  it('names the sidebar switch by what it does next', () => {
    const label = (sidebarCollapsed: boolean) =>
      paletteCommands({ ...all(), sidebarCollapsed, mac: false }).find((one) => one.id === 'toggle-sidebar');
    expect(label(true)).toMatchObject({ label: 'Show sidebar', shortcut: 'Ctrl+B' });
    expect(label(false)).toMatchObject({ label: 'Collapse sidebar' });
  });

  it('is found by the words of each command', () => {
    const commands = paletteCommands(all());
    const find = (query: string) =>
      paletteItems({ chats: [], sessions: [], commands }, query).map((item) => item.title);
    expect(find('sidebar')).toEqual(['Collapse sidebar']);
    expect(find('approvals')).toEqual(['Needs you']);
    expect(find('settings')).toEqual(['Settings: Agents', 'Settings: Project team']);
    expect(find("what's new")).toEqual(['What’s new']);
    expect(find('keys')).toEqual(['Commands and keys']);
  });
});
