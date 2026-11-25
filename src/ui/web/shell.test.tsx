// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/group.js';
import { EscapeActive } from '../../react/escape.js';
import { BUG_REPORT_URL, SUPPORT_URL } from '../../support.js';
import { chatProjects, needsYou, quotaRows, sessionKey } from '../sidebar.js';
import { ViewerPanel } from './file-view.js';
import { holdsTypedText, Shell, SIDEBAR_KEY, type ShellProps } from './shell.js';
import { TERMS_URL } from './sidebar.js';
import { TranscriptMenu } from './transcript-menu.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse('2026-11-25T10:00:00Z');
const chat = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id,
  where: 'local',
  cwd: '/work/app',
  title: `Chat ${id}`,
  state: 'waiting',
  updatedAt: now - 120_000,
  ...patch,
});

const chats = [chat('a'), chat('b', { cwd: '/work/site', state: 'active' }), chat('c', { cwd: '/work/site' })];

function memoryStore(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[SIDEBAR_KEY, initial]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

let host: HTMLDivElement;
let root: Root;

function props(patch: Partial<ShellProps> = {}, side: Partial<ShellProps['side']> = {}): ShellProps {
  return {
    title: 'Chat a',
    store: memoryStore(),
    children: <div className="workspace">chat</div>,
    search: {
      chats,
      sessions: [chat('x', { agent: 'codex', source: 'codex', title: 'Other work', cwd: '/work/bakery' })],
      onOpenSession: vi.fn(),
      settings: [{ label: 'Agents', onSelect: vi.fn() }],
    },
    ...patch,
    side: {
      page: 'chat',
      onNewChat: vi.fn(),
      needs: needsYou({ approvals: 1, tower: [{ id: 'draft-1' }, { id: 'draft-2' }], now }),
      onNeedsYou: vi.fn(),
      onAllSessions: vi.fn(),
      projects: chatProjects(chats),
      selectedChat: sessionKey(chats[0]!),
      onOpenChat: vi.fn(),
      onNewChatIn: vi.fn(),
      others: { shown: [chat('x', { agent: 'codex', source: 'codex', title: 'Other work' })], total: 7 },
      quota: quotaRows([{ agent: 'claude', window: '5h', status: 'warning', usedPercent: 91 }], ['claude'], now),
      onSettings: vi.fn(),
      version: '3.3.0',
      connected: true,
      now,
      ...side,
    },
  };
}

const render = (value: ShellProps) => act(() => root.render(<Shell {...value} />));
const shell = () => host.querySelector('.shell')!;
const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find(
    (one) => one.getAttribute('aria-label') === name || one.textContent?.trim() === name,
  )!;
const click = (element: Element) => act(() => (element as HTMLElement).click());
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
/** ⌘ on a Mac, Ctrl elsewhere: the page decides by the platform it runs on. */
const mod = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('<Shell>', () => {
  it('renders the sidebar beside a top bar with the title, the project and the usage', () => {
    render(props({ project: { name: 'app', path: '/work/app' }, usage: '12k tokens', subtitle: 'Billing' }));
    expect(host.querySelector('aside.side')?.getAttribute('aria-label')).toBe('Sidebar');
    const bar = host.querySelector('header.topbar')!;
    expect(bar.querySelector('h1')?.textContent).toBe('Chat a');
    expect(bar.querySelector('.conv-topic')?.textContent).toBe('Billing');
    expect(bar.querySelector('.crumb')?.textContent).toBe('app');
    expect(bar.querySelector('.crumb')?.getAttribute('title')).toBe('/work/app');
    expect(bar.querySelector('.tokens')?.textContent).toBe('12k tokens');
    // The window moves by its top bar and the sidebar's top strip in the desktop app.
    expect(bar.getAttribute('data-tauri-drag-region')).toBe('deep');
    expect(host.querySelector('.side-top')?.getAttribute('data-tauri-drag-region')).toBe('deep');
    expect(host.querySelector('.center .workspace')?.textContent).toBe('chat');
    // No back arrow and no Show sidebar button while the chat shows beside a full sidebar.
    expect(bar.querySelectorAll('button')).toHaveLength(0);
  });

  it('folds to the rail with the button and with ⌘B, and remembers it', () => {
    const store = memoryStore();
    render(props({ store }));
    expect(shell().classList.contains('side-collapsed')).toBe(false);
    click(button('Collapse sidebar'));
    expect(shell().classList.contains('side-collapsed')).toBe(true);
    expect(store.getItem(SIDEBAR_KEY)).toBe('1');
    // Collapsed, the top bar offers the way back.
    click(host.querySelector('header.topbar button[aria-label="Show sidebar"]')!);
    expect(shell().classList.contains('side-collapsed')).toBe(false);
    expect(store.getItem(SIDEBAR_KEY)).toBe('0');
    press('b', mod());
    expect(shell().classList.contains('side-collapsed')).toBe(true);
    expect(store.getItem(SIDEBAR_KEY)).toBe('1');
    // With another modifier it is somebody else's key.
    press('b', { ...mod(), shiftKey: true });
    expect(shell().classList.contains('side-collapsed')).toBe(true);
  });

  it('starts as it was left, and as the rail in a narrow window until the person chooses', () => {
    render(props({ store: memoryStore('1') }));
    expect(shell().classList.contains('side-collapsed')).toBe(true);
    act(() => root.unmount());

    root = createRoot(host);
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(900);
    try {
      render(props());
      expect(shell().classList.contains('side-collapsed')).toBe(true);
      // The window grows: the sidebar follows, since nothing was chosen.
      width.mockReturnValue(1280);
      act(() => void window.dispatchEvent(new Event('resize')));
      expect(shell().classList.contains('side-collapsed')).toBe(false);
      // Once chosen, the width no longer decides.
      click(button('Collapse sidebar'));
      act(() => void window.dispatchEvent(new Event('resize')));
      expect(shell().classList.contains('side-collapsed')).toBe(true);
    } finally {
      width.mockRestore();
    }
  });

  it('groups chats by project and marks the open one', () => {
    const value = props();
    render(value);
    const projects = Array.from(host.querySelectorAll('details.proj'));
    expect(projects.map((one) => one.querySelector('summary .grow')?.textContent)).toEqual(['app', 'site']);
    expect(projects.map((one) => one.querySelector('summary')?.getAttribute('title'))).toEqual([
      '/work/app',
      '/work/site',
    ]);
    const rows = Array.from(host.querySelectorAll('details.proj button.nav.chat'));
    expect(rows.map((row) => row.querySelector('.grow')?.textContent)).toEqual(['Chat a', 'Chat b', 'Chat c']);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['page', null, null]);
    // State glyphs: an ended turn, an agent at work.
    expect(rows.map((row) => row.querySelector('svg.sg')?.getAttribute('aria-label'))).toEqual([
      'Done',
      'Running',
      'Done',
    ]);
    expect(rows[0]!.querySelector('small')?.textContent).toBe('2m');
    expect(rows[1]!.querySelector('small')?.textContent).toBe('now');

    click(rows[2]!);
    expect(value.side.onOpenChat).toHaveBeenCalledWith(chats[2]);
  });

  it('shows the open chat’s live state on its row', () => {
    render(props({}, { selectedGlyph: 'ask' }));
    const row = host.querySelector('details.proj button.nav.chat')!;
    expect(row.querySelector('svg.sg')?.getAttribute('aria-label')).toBe('Needs you');
  });

  it('selects the page instead of the chat while a page is open', () => {
    const onBack = vi.fn();
    render(props({ title: 'All sessions', onBack }, { page: 'sessions' }));
    expect(host.querySelectorAll('details.proj [aria-current="page"]')).toHaveLength(0);
    expect(button('All sessions').getAttribute('aria-current')).toBe('page');
    expect(button('Needs you, 3').getAttribute('aria-current')).toBeNull();
    click(button('Chat'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('starts a chat in a project from its heading', () => {
    const value = props({}, { canNewChatIn: (project) => project.name !== 'app' });
    render(value);
    expect(button('New chat here, app')).toBeUndefined();
    // That the heading stays unfolded is the browser's doing: sidebar.browser.test.ts checks it.
    click(button('New chat here, site'));
    expect(value.side.onNewChatIn).toHaveBeenCalledWith(expect.objectContaining({ key: '/work/site' }));
  });

  it('lists the other agents’ sessions with their agent and a link to all of them', () => {
    const value = props();
    render(value);
    const other = host.querySelector('section.other')!;
    expect(other.getAttribute('aria-label')).toBe("Other agents' sessions");
    expect(other.querySelector('.tag')?.textContent).toBe('codex');
    expect(other.textContent).toContain('Other work');
    click(button('Show all 7 sessions'));
    expect(value.side.onAllSessions).toHaveBeenCalledTimes(1);
  });

  it('has the navigation, the count of what needs you, quota, update and connection', () => {
    const onRelaunch = vi.fn();
    const value = props(
      {},
      { update: { version: '3.4.0', ready: true }, onRelaunch, whatsNewUnread: true, onWhatsNew: vi.fn() },
    );
    render(value);
    const needs = button('Needs you, 3');
    expect(needs.querySelector('.count')?.textContent).toBe('3');
    expect(needs.getAttribute('title')).toBe('Needs you: 3 across all projects, 1 in this chat');
    click(needs);
    expect(value.side.onNeedsYou).toHaveBeenCalledTimes(1);
    click(button('New chat'));
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
    expect(button('Search').getAttribute('aria-disabled')).toBeNull();
    expect(button('Search').getAttribute('title')).toBe('Search chats and sessions (⌘K)');

    expect(host.querySelector('.quota-row')?.textContent).toBe('claude91% · 5h');
    expect(host.querySelector('.quota-row')?.getAttribute('data-level')).toBe('warning');
    expect(host.querySelector('.quota .ring')?.textContent).toBe('91');
    // The ring opens Settings › Usage only where there is one; else it only shows the limits.
    expect((button('Plan limits') as HTMLButtonElement).disabled).toBe(true);
    const onQuota = vi.fn();
    render(props({}, { ...value.side, onQuota }));
    expect((button('Plan limits') as HTMLButtonElement).disabled).toBe(false);
    click(button('Plan limits'));
    expect(onQuota).toHaveBeenCalledTimes(1);
    click(button('Install 3.4.0 and relaunch'));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.conn')?.textContent).toBe('Connected · 3.3.0');
    // What's new not opened yet: a dot on Help, nothing louder.
    expect(button('Help').querySelector('.badge-dot')).not.toBeNull();

    render(props({}, { connected: false, update: { version: '3.4.0', ready: false } }));
    expect(host.querySelector('.conn')?.textContent).toBe('Disconnected · 3.3.0');
    expect(host.querySelector('.conn')?.classList.contains('off')).toBe(true);
    expect((button('Downloading update…') as HTMLButtonElement).disabled).toBe(true);
    expect(button('Help').querySelector('.badge-dot')).toBeNull();
  });

  it('opens Help with What’s new, the support links and Terms; Escape closes it and goes no further', () => {
    const onBack = vi.fn();
    const onWhatsNew = vi.fn();
    render(props({ onBack }, { onWhatsNew, onCommands: vi.fn() }));
    click(button('Help'));
    const menu = host.querySelector('[role="menu"][aria-label="Help"]')!;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual([
      'What’s new3.3.0',
      'Get help',
      'Report a bug',
      'Terms',
      'Commands and keys',
    ]);
    expect(items.slice(1, 4).map((item) => item.getAttribute('href'))).toEqual([
      SUPPORT_URL,
      BUG_REPORT_URL,
      TERMS_URL,
    ]);
    press('Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    click(button('Help'));
    click(host.querySelector('[role="menuitem"]')!);
    expect(onWhatsNew).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens the Settings page from its button and on ⌘, and marks it while it shows', () => {
    const onSettings = vi.fn();
    render(props({}, { onSettings }));
    // A button of its own, not a menu: the page has the sections.
    expect(button('Settings').getAttribute('aria-haspopup')).toBeNull();
    expect(button('Settings').getAttribute('aria-current')).toBeNull();
    click(button('Settings'));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    press(',', mod());
    expect(onSettings).toHaveBeenCalledTimes(2);

    render(props({ title: 'Settings', onBack: vi.fn() }, { onSettings, page: 'settings' }));
    expect(button('Settings').getAttribute('aria-current')).toBe('page');

    render(props({}, { onSettings: undefined }));
    expect(button('Settings')).toBeUndefined();
    // Without a page to open the key is left alone.
    const event = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true, ...mod() });
    act(() => void document.body.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  });

  it('goes back from a page on Escape, but not past a dialog or over typed text', () => {
    const onBack = vi.fn();
    render(props({ title: 'All sessions', onBack }, { page: 'sessions' }));
    const field = document.createElement('input');
    host.append(field);
    field.value = 'draft';
    press('Escape', {}, field);
    expect(onBack).not.toHaveBeenCalled();
    field.value = '';
    press('Escape', {}, field);
    expect(onBack).toHaveBeenCalledTimes(1);

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    press('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
    dialog.remove();
    press('Escape');
    expect(onBack).toHaveBeenCalledTimes(2);

    // A checkbox's value ("on") or a button's is not typed text: the page goes back.
    const box = document.createElement('input');
    box.type = 'checkbox';
    host.append(box);
    press('Escape', {}, box);
    expect(onBack).toHaveBeenCalledTimes(3);
    for (const type of ['radio', 'button', 'range', 'color']) {
      const other = document.createElement('input');
      other.type = type;
      other.value = 'x';
      expect(holdsTypedText(other)).toBe(false);
    }
    for (const type of ['text', 'search', 'url', 'email', 'password']) {
      const other = document.createElement('input');
      other.type = type;
      other.value = 'x';
      expect(holdsTypedText(other)).toBe(true);
    }
    const area = document.createElement('textarea');
    area.value = 'x';
    expect(holdsTypedText(area)).toBe(true);
  });

  it('gives Escape to what was opened last: the menu, then the viewer, then the page, one press each', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const onStop = vi.fn();
    const artifact = {
      id: 'a1',
      name: 'report',
      title: 'Report',
      kind: 'file' as const,
      mimeType: 'application/zip',
      bytes: 10,
      version: 1,
    };
    const page = (viewer: boolean) =>
      props({
        title: 'All sessions',
        onBack,
        children: (
          <div className="workspace">
            {/* The message field's own key, as <AgentChat> has it: Escape there stops the turn. */}
            <textarea aria-label="Message" onKeyDown={(event) => event.key === 'Escape' && onStop()} />
            {viewer ? (
              <ViewerPanel
                target={{ kind: 'artifact', id: 'a1' }}
                token="t"
                artifacts={[{ id: 'a1', latest: artifact, versions: [artifact] }]}
                onClose={onClose}
              />
            ) : null}
          </div>
        ),
      });
    render(page(true));
    const field = host.querySelector('textarea')!;
    // The viewer was open first; Help opens over it. Rendering again must not put the viewer back on top.
    click(button('Help'));
    render(page(true));
    expect(host.querySelector('[role="menu"][aria-label="Help"]')).not.toBeNull();

    press('Escape', {}, field);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('.viewer-panel')).not.toBeNull();
    expect([onClose.mock.calls.length, onBack.mock.calls.length, onStop.mock.calls.length]).toEqual([0, 0, 0]);

    press('Escape', {}, field);
    expect([onClose.mock.calls.length, onBack.mock.calls.length, onStop.mock.calls.length]).toEqual([1, 0, 0]);
    render(page(false));

    // A page hides the chat, so the focus is not in the message field then.
    press('Escape');
    expect([onClose.mock.calls.length, onBack.mock.calls.length, onStop.mock.calls.length]).toEqual([1, 1, 0]);

    // In the chat, with nothing open, the key is the message field's again.
    render({ ...page(false), onBack: undefined });
    press('Escape', {}, host.querySelector('textarea')!);
    expect([onClose.mock.calls.length, onBack.mock.calls.length, onStop.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it('passes Escape over a viewer hidden under a page: the page goes first, the viewer when it shows again', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const artifact = {
      id: 'a1',
      name: 'report',
      title: 'Report',
      kind: 'file' as const,
      mimeType: 'application/zip',
      bytes: 10,
      version: 1,
    };
    // As the window has it: the chat's workspace stays mounted, hidden, while a page is open.
    const window = (page: boolean) =>
      props({
        title: page ? 'All sessions' : 'Chat',
        onBack: page ? onBack : undefined,
        children: (
          <div className="workspace" style={page ? { display: 'none' } : undefined}>
            <EscapeActive.Provider value={!page}>
              <ViewerPanel
                target={{ kind: 'artifact', id: 'a1' }}
                token="t"
                artifacts={[{ id: 'a1', latest: artifact, versions: [artifact] }]}
                onClose={onClose}
              />
            </EscapeActive.Provider>
          </div>
        ),
      });
    // A viewer is open in the chat, then All sessions is clicked.
    render(window(false));
    render(window(true));
    press('Escape');
    expect([onClose.mock.calls.length, onBack.mock.calls.length]).toEqual([0, 1]);
    // Back in the chat the viewer is still open, and the key is its own again.
    render(window(false));
    expect(host.querySelector('.viewer-panel')).not.toBeNull();
    press('Escape');
    expect([onClose.mock.calls.length, onBack.mock.calls.length]).toEqual([1, 1]);
  });

  it('ends the chat list with All chats, the way to the older and the archived ones', () => {
    const onAllChats = vi.fn();
    render(props({}, { onAllChats }));
    const all = button('All chats');
    // After the projects, before the other agents' sessions.
    const rows = Array.from(host.querySelectorAll('.side-scroll > *'));
    expect(rows.indexOf(all)).toBe(rows.findIndex((row) => row.matches('section.other')) - 1);
    expect(all.getAttribute('aria-current')).toBeNull();
    click(all);
    expect(onAllChats).toHaveBeenCalledTimes(1);

    render(props({ title: 'All chats', onBack: vi.fn() }, { onAllChats, page: 'chats' }));
    expect(button('All chats').getAttribute('aria-current')).toBe('page');
    expect(button('All sessions').getAttribute('aria-current')).toBeNull();
    // Also with no recent chat at all: the older ones are still somewhere.
    render(props({}, { onAllChats, projects: [] }));
    expect(button('All chats')).toBeDefined();
    // No session index, no list to go to.
    render(props());
    expect(button('All chats')).toBeUndefined();
  });

  it('leaves Escape alone in the chat: stopping a turn is the message field’s own key', () => {
    const value = props();
    render(value);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  });

  it('starts a chat on ⌘N, and not on a bare n', () => {
    const value = props();
    render(value);
    press('n', mod());
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
    press('n');
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
  });
});

describe('Search (⌘K)', () => {
  const palette = () => host.querySelector<HTMLElement>('.palette');
  const field = () => host.querySelector<HTMLInputElement>('.palette input')!;
  const rows = () => Array.from(host.querySelectorAll('.palette [role=option]'));
  const row = (item: Element) =>
    Array.from(item.children)
      .map((part) => part.textContent)
      .filter(Boolean)
      .join(' | ');
  const selected = () => host.querySelector('.palette [aria-selected=true]')?.querySelector('.grow')?.textContent;
  // React reads the value through the element's own setter.
  const type = (text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), text);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const key = (name: string, init: KeyboardEventInit = {}) => press(name, init, field());

  it('opens on ⌘K and from the sidebar, with the chats, the other sessions and the commands', () => {
    render(props({}, { onAllChats: vi.fn(), onCommands: vi.fn(), selectedGlyph: 'err' }));
    expect(palette()).toBeNull();
    press('k', mod());
    expect(palette()?.getAttribute('role')).toBe('dialog');
    expect(palette()?.getAttribute('aria-label')).toBe('Search chats and sessions');
    expect(document.activeElement).toBe(field());
    const key = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    expect(rows().map(row)).toEqual([
      'Chat a | app | claude | chat',
      'Chat b | site | claude | chat',
      'Chat c | site | claude | chat',
      'Other work | bakery | codex | session',
      `New chat | ${key}N | command`,
      'Needs you (3) | command',
      'All sessions | command',
      'All chats | command',
      'Settings: Agents | command',
      `Collapse sidebar | ${key}B | command`,
      'Commands and keys | command',
    ]);
    expect(rows().filter((one) => one.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    // The glyphs are those of the sidebar: the open chat as it is now, the others as the stores say.
    expect(
      rows()
        .slice(0, 3)
        .map((one) => one.querySelector('.sg')?.getAttribute('class')),
    ).toEqual(['sg err', 'sg run', 'sg ok']);
    expect(field().getAttribute('aria-activedescendant')).toBe(rows()[0]!.id);
    // ⌘K again closes it.
    press('k', mod());
    expect(palette()).toBeNull();
    click(button('Search'));
    expect(palette()).not.toBeNull();
  });

  it('moves with the arrows, around the ends, and starts again from the top when the words change', () => {
    render(props());
    press('k', mod());
    expect(selected()).toBe('Chat a');
    key('ArrowDown');
    key('ArrowDown');
    expect(selected()).toBe('Chat c');
    expect(field().getAttribute('aria-activedescendant')).toBe(rows()[2]!.id);
    key('ArrowUp');
    expect(selected()).toBe('Chat b');
    key('Home');
    key('ArrowUp');
    expect(selected()).toBe('Collapse sidebar');
    key('ArrowDown');
    expect(selected()).toBe('Chat a');
    key('ArrowDown');
    type('site');
    expect(rows().map(row)).toEqual(['Chat b | site | claude | chat', 'Chat c | site | claude | chat']);
    expect(selected()).toBe('Chat b');
    type('nothing like it');
    expect(rows()).toHaveLength(0);
    expect(host.querySelector('.palette-none')?.textContent).toBe('No chat, session or command matches.');
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
    // Enter with nothing to open leaves it as it is.
    key('Enter');
    expect(palette()).not.toBeNull();
  });

  it('opens the chat under the selection on Enter, as its row in the sidebar does', () => {
    const value = props();
    render(value);
    press('k', mod());
    type('site');
    key('ArrowDown');
    key('Enter');
    expect(palette()).toBeNull();
    expect(value.side.onOpenChat).toHaveBeenCalledTimes(1);
    expect(value.side.onOpenChat).toHaveBeenCalledWith(chats[2]);
    expect(value.search!.onOpenSession).not.toHaveBeenCalled();
  });

  it('keeps the selected row selected when the list is refreshed under it', () => {
    const value = props();
    render(value);
    press('k', mod());
    key('ArrowDown');
    expect(selected()).toBe('Chat b');
    // A chat worked in just now moves to the top: the rows below it move down one.
    const fresh = chat('d', { title: 'Chat d', updatedAt: now });
    render({ ...value, search: { ...value.search!, chats: [fresh, ...chats] } });
    expect(rows().map(row)[0]).toMatch(/^Chat d/);
    expect(selected()).toBe('Chat b');
    key('Enter');
    expect(value.side.onOpenChat).toHaveBeenCalledWith(chats[1]);
    // A row that left the list gives the selection back to the first.
    press('k', mod());
    key('ArrowDown');
    key('ArrowDown');
    expect(selected()).toBe('Chat b');
    render({ ...value, search: { ...value.search!, chats: [fresh, chats[0]!, chats[2]!] } });
    expect(selected()).toBe('Chat d');
  });

  it('keeps the first row selected when a refresh puts a newer one above it', () => {
    const value = props();
    render(value);
    press('k', mod());
    expect(selected()).toBe('Chat a');
    const fresh = chat('d', { title: 'Chat d', updatedAt: now });
    render({ ...value, search: { ...value.search!, chats: [fresh, ...chats] } });
    expect(rows().map(row)[0]).toMatch(/^Chat d/);
    expect(selected()).toBe('Chat a');
    key('Enter');
    expect(value.side.onOpenChat).toHaveBeenCalledWith(chats[0]);
    // The same after words were typed: the first match is kept.
    press('k', mod());
    type('chat');
    expect(selected()).toBe('Chat d');
    const newer = chat('e', { title: 'Chat e', updatedAt: now + 1 });
    render({ ...value, search: { ...value.search!, chats: [newer, fresh, ...chats] } });
    expect(selected()).toBe('Chat d');
  });

  it('moves to the first and last row with Home and End, also with words typed', () => {
    render(props());
    press('k', mod());
    type('chat');
    expect(selected()).toBe('Chat a');
    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(end));
    expect(end.defaultPrevented).toBe(true);
    expect(selected()).toBe(
      rows()
        .map((one) => one.querySelector('.grow')?.textContent)
        .at(-1),
    );
    expect(selected()).not.toBe('Chat a');
    key('Home');
    expect(selected()).toBe('Chat a');
    // Shift+End still selects text in the field.
    const shiftEnd = new KeyboardEvent('keydown', { key: 'End', shiftKey: true, bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(shiftEnd));
    expect(shiftEnd.defaultPrevented).toBe(false);
    expect(selected()).toBe('Chat a');
  });

  it('closes a menu open under it, so a press in the palette keeps the way back to its button', () => {
    render(props());
    click(button('Help'));
    const item = host.querySelector<HTMLElement>('[role=menu] [role=menuitem], [role=menu] a, [role=menu] button')!;
    item.focus();
    expect(document.activeElement).toBe(item);
    press('k', mod(), item);
    expect(host.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(field());
    // A press in the palette, then Escape: the focus goes back to the menu's button.
    act(() => void rows()[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    expect(palette()).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(escape));
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(button('Help'));
  });

  it('closes the Session menu of the top bar under it, and gives the focus back to its button', () => {
    render(
      props({
        actions: (
          <TranscriptMenu token="t" endpoint="/api/transcript" sessionId="s" sessionPath="/s.jsonl" label="Session" />
        ),
      }),
    );
    click(button('Session'));
    const item = host.querySelector<HTMLElement>('.tm-popover [role=menuitem]')!;
    item.focus();
    press('k', mod(), item);
    expect(host.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(field());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(escape));
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(button('Session'));
  });

  it('goes to another agent’s session, and opens a row on a click', () => {
    const value = props();
    render(value);
    press('k', mod());
    type('codex');
    key('Enter');
    expect(value.search!.onOpenSession).toHaveBeenCalledWith(value.search!.sessions[0]);
    expect(value.side.onOpenChat).not.toHaveBeenCalled();
    press('k', mod());
    click(rows()[1]!);
    expect(palette()).toBeNull();
    expect(value.side.onOpenChat).toHaveBeenCalledWith(chats[1]);
  });

  it('runs a command: a page of the sidebar, or the sidebar’s own switch', () => {
    const value = props();
    render(value);
    press('k', mod());
    type('all sessions');
    key('Enter');
    expect(value.side.onAllSessions).toHaveBeenCalledTimes(1);
    press('k', mod());
    type('settings');
    key('Enter');
    expect(value.search!.settings![0]!.onSelect).toHaveBeenCalledTimes(1);
    press('k', mod());
    type('sidebar');
    key('Enter');
    expect(shell().classList.contains('side-collapsed')).toBe(true);
    press('k', mod());
    type('sidebar');
    expect(rows().map(row)[0]).toMatch(/^Show sidebar/);
    // ⌘N starts the chat and takes the palette away.
    press('n', mod(), field());
    expect(palette()).toBeNull();
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and puts the focus back where it was, without leaving the page under it', () => {
    const onBack = vi.fn();
    render(props({ onBack, children: <textarea className="draft" defaultValue="" /> }));
    const draft = host.querySelector<HTMLTextAreaElement>('.draft')!;
    draft.focus();
    press('k', mod(), draft);
    expect(document.activeElement).toBe(field());
    type('chat');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(escape));
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(draft);
    // One press closed one thing: the page is still there.
    expect(onBack).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(true);
    press('Escape', {}, draft);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('closes on a press beside it, back to the button that opened it, and keeps Tab in the field', () => {
    render(props());
    button('Search').focus();
    click(button('Search'));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    act(() => {
      host.querySelector('.palette-bg')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(button('Search'));
  });

  it('is not there in a window with nothing to search: the button says so', () => {
    render(props({ search: undefined }));
    expect(button('Search').getAttribute('aria-disabled')).toBe('true');
    press('k', mod());
    click(button('Search'));
    expect(palette()).toBeNull();
  });

  it('stays closed under an open dialog', () => {
    render(props({ children: <dialog open>notes</dialog> }));
    press('k', mod());
    expect(palette()).toBeNull();
  });
});
