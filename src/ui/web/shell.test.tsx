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
    ...patch,
    side: {
      page: 'chat',
      onNewChat: vi.fn(),
      onSearch: vi.fn(),
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
    // Search waits for its palette: the button says so.
    expect(button('Search').getAttribute('aria-disabled')).toBe('true');

    expect(host.querySelector('.quota-row')?.textContent).toBe('claude91% · 5h');
    expect(host.querySelector('.quota-row')?.getAttribute('data-level')).toBe('warning');
    expect(host.querySelector('.quota .ring')?.textContent).toBe('91');
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

  it('starts a chat on ⌘N and calls Search on ⌘K', () => {
    const value = props();
    render(value);
    press('n', mod());
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
    press('K', mod());
    expect(value.side.onSearch).toHaveBeenCalledTimes(1);
    press('n');
    expect(value.side.onNewChat).toHaveBeenCalledTimes(1);
  });
});
