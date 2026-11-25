import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionInfo } from '../../agents/sessions/group.js';
import { ownEscape } from '../../react/escape.js';
import { paletteCommands } from '../palette.js';
import { escapeAction, RAIL_BELOW_PX, startsCollapsed } from '../sidebar.js';
import { Palette } from './palette.js';
import { Icon, Sidebar, type SidebarProps } from './sidebar.js';

/** Where the sidebar's state is kept: `1` for the rail, `0` for the full sidebar. */
export const SIDEBAR_KEY = 'genaicode-sidebar';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readStore(store: Store | undefined): string | null {
  try {
    return (store ?? localStorage).getItem(SIDEBAR_KEY);
  } catch {
    // Storage blocked: the width decides.
    return null;
  }
}

/** Input types a person types text into; a checkbox's or a button's `value` is not typed text. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'number', 'password', 'tel']);

/** Whether Escape lands in a control holding text that was typed (a page stays open over it). */
export function holdsTypedText(target: EventTarget | null): target is HTMLElement {
  if (target instanceof HTMLTextAreaElement) return !!target.value;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type) && !!target.value;
  return target instanceof HTMLElement && target.isContentEditable && !!target.textContent;
}

/**
 * The open menus and popovers of the window, whichever component draws them: each marks its panel
 * with `data-popup` and sits beside its button in one anchor.
 */
const POPUP = '[data-popup]';

/** The button of the open menu or popover that `focused` is in, or undefined outside one. */
function popupTrigger(focused: Element | null): HTMLElement | undefined {
  const popup = focused?.closest(POPUP);
  return popup?.parentElement?.querySelector<HTMLElement>(':scope > button[aria-expanded="true"]') ?? undefined;
}

export interface ShellProps {
  /** The sidebar's content; the shell owns whether it is collapsed, and Search. */
  side: Omit<SidebarProps, 'collapsed' | 'onToggle' | 'onSearch'>;
  /**
   * What Search (⌘K) looks through, beside the commands the sidebar has. A chat opens as its row in
   * the sidebar does (`side.onOpenChat`). Absent: no palette, and the Search button says so.
   */
  search?: {
    /** This app's chats. */
    chats: readonly SessionInfo[];
    /** The sessions this app did not start, where there is a session index. */
    sessions: readonly SessionInfo[];
    /** The directory of chats started without a folder ("Home folder"). */
    home?: string;
    /** Goes to a session of another agent. */
    onOpenSession(session: SessionInfo): void;
    /** The sections of the Settings page, each a command that opens it there. */
    settings?: ReadonlyArray<{ label: string; onSelect(): void }>;
  };
  /** The chat's title, or the name of the page in its place. */
  title: string;
  /** A second, quiet name beside the title: the topic of the chat. */
  subtitle?: string;
  /** The directory the chat works in: its folder name, the full path as tooltip. */
  project?: { name: string; path: string };
  /** A page is open in the chat's place: the bar gets a back arrow, and Escape goes back. */
  onBack?(): void;
  /** Token usage of the conversation, as quiet text. */
  usage?: string;
  /** The right end of the bar: the session menu and what has no panel yet. */
  actions?: ReactNode;
  /**
   * The work panel, beside the chat. With `workFull` it is a view in the chat's place, under the
   * top bar: `onBack` then closes it.
   */
  work?: ReactNode;
  workFull?: boolean;
  /** ⌘⌥B: opens and closes the work panel. */
  onToggleWork?(): void;
  /** Stop in the top bar: the turn runs while the full-width work view covers the composer. */
  onStop?(): void;
  /**
   * The width the chat and the work panel share (the window without the sidebar) and the window's
   * own, whenever either changes: what `workPanelLayout()` decides from.
   */
  onRoom?(sizes: { room: number; window: number }): void;
  /** For tests: where the collapsed state is kept. Default `localStorage`. */
  store?: Store;
  children: ReactNode;
}

/**
 * The window: the sidebar on the left, and the slim top bar over the chat or a page. ⌘B folds the
 * sidebar to its rail (remembered; the rail is the default in a narrow window), ⌘N starts a chat,
 * ⌘K opens and closes Search, ⌘, opens Settings. Escape goes back from a page to the chat; it never
 * reaches a running turn from here.
 */
export function Shell(props: ShellProps) {
  const [collapsed, setCollapsed] = useState(() => startsCollapsed(readStore(props.store), window.innerWidth));
  const latest = useRef(props);
  latest.current = props;
  const toggle = () =>
    setCollapsed((value) => {
      try {
        (latest.current.store ?? localStorage).setItem(SIDEBAR_KEY, value ? '0' : '1');
      } catch {
        // Storage blocked: the choice lasts until the page is closed.
      }
      return !value;
    });

  const [searching, setSearching] = useState(false);
  const searchingRef = useRef(searching);
  searchingRef.current = searching;
  /** Where the focus was when Search opened: closing it puts the focus back there. */
  const searchFrom = useRef<Element | null>(null);
  const openSearch = () => {
    // Nothing to search, or a dialog is over the page and would cover the palette.
    if (!latest.current.search || searchingRef.current || document.querySelector('dialog[open]')) return;
    const from = document.activeElement;
    // A menu or popover open under it closes now, as a press beside it would close it: else the
    // first press in the palette would, and take away the focus kept for its return. The focus goes
    // back to the popup's button then.
    const trigger = popupTrigger(from);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    searchFrom.current = trigger ?? from;
    setSearching(true);
  };
  const closeSearch = (restore = true) => {
    if (!searchingRef.current) return;
    setSearching(false);
    const from = searchFrom.current;
    searchFrom.current = null;
    if (restore && from instanceof HTMLElement && from.isConnected) from.focus();
  };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const { side } = props;
  const commands = useMemo(
    () =>
      paletteCommands({
        onNewChat: () => latest.current.side.onNewChat(),
        onNeedsYou: () => latest.current.side.onNeedsYou(),
        needs: side.needs.total,
        onAllSessions: side.onAllSessions && (() => latest.current.side.onAllSessions?.()),
        onAllChats: side.onAllChats && (() => latest.current.side.onAllChats?.()),
        settings: props.search?.settings?.map((item, index) => ({
          label: item.label,
          onSelect: () => latest.current.search?.settings?.[index]?.onSelect(),
        })),
        onWhatsNew: side.onWhatsNew && (() => latest.current.side.onWhatsNew?.()),
        onCommands: side.onCommands && (() => latest.current.side.onCommands?.()),
        onToggleSidebar: toggle,
        sidebarCollapsed: collapsed,
        mac,
      }),
    [
      side.needs.total,
      !side.onAllSessions,
      !side.onAllChats,
      props.search?.settings?.map((item) => item.label).join('\n'),
      !side.onWhatsNew,
      !side.onCommands,
      collapsed,
      mac,
    ],
  );
  const search = props.search;
  const source = useMemo(
    () => (search ? { chats: search.chats, sessions: search.sessions, home: search.home, commands } : undefined),
    [search?.chats, search?.sessions, search?.home, commands],
  );

  // The window is this app's alone: an Escape that a menu, popover or viewer took reaches nothing else.
  useEffect(() => ownEscape(), []);

  useEffect(() => {
    // Until the person chooses, the width does: the rail below 980 px.
    const onResize = () => {
      if (readStore(latest.current.store) === null) setCollapsed(window.innerWidth < RAIL_BELOW_PX);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const now = latest.current;
      if (event.key === 'Escape') {
        // An open dialog takes its own Escape, and so did any menu before the key got here.
        if (document.querySelector('dialog[open]')) return;
        // Text being typed is not thrown away with the page: Escape clears the field first.
        if (holdsTypedText(event.target) && now.onBack) return;
        if (escapeAction({ page: !!now.onBack }) === 'page') {
          event.preventDefault();
          now.onBack?.();
        }
        return;
      }
      if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) || event.shiftKey) return;
      if (event.altKey) {
        // By its place on the keyboard: with Option held, macOS types another letter there.
        // Not under Search: it keeps the focus until Escape gives it back where it was.
        if (event.code === 'KeyB' && now.onToggleWork && !searchingRef.current) {
          event.preventDefault();
          now.onToggleWork();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        toggle();
      } else if (key === 'n') {
        event.preventDefault();
        // The new chat takes the focus: Search does not stay over it.
        closeSearch(false);
        now.side.onNewChat();
      } else if (key === 'k') {
        event.preventDefault();
        if (searchingRef.current) closeSearch();
        else openSearch();
      } else if (key === ',' && now.side.onSettings) {
        event.preventDefault();
        // Settings takes the page: Search does not stay over it.
        closeSearch(false);
        now.side.onSettings();
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // The room beside the sidebar: it changes with the window and with the sidebar's own width.
  const shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = shell.current;
    if (!el) return;
    const report = () => {
      const side = el.querySelector<HTMLElement>('.side');
      latest.current.onRoom?.({ room: el.clientWidth - (side?.offsetWidth ?? 0), window: el.clientWidth });
    };
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed]);

  return (
    <div
      ref={shell}
      className={`shell${collapsed ? ' side-collapsed' : ''}${props.work ? ' has-work' : ''}${props.work && props.workFull ? ' work-full' : ''}`}
    >
      <Sidebar
        {...props.side}
        collapsed={collapsed}
        onToggle={toggle}
        onSearch={props.search ? openSearch : undefined}
      />
      <div className="center">
        {/* In the desktop app the top bar is the window's title bar: it moves the window. */}
        <header className="topbar" data-tauri-drag-region="deep">
          {collapsed ? (
            <button
              type="button"
              className="btn ghost icon sm"
              title="Show sidebar (⌘B)"
              aria-label="Show sidebar"
              aria-expanded={false}
              data-tauri-drag-region="false"
              onClick={toggle}
            >
              <Icon name="side" />
            </button>
          ) : null}
          {props.onBack ? (
            <button
              type="button"
              className="btn ghost sm"
              title="Back to the chat (Esc)"
              data-tauri-drag-region="false"
              onClick={props.onBack}
            >
              <Icon name="back" />
              Chat
            </button>
          ) : null}
          <h1 title={props.title}>{props.title}</h1>
          {props.subtitle ? <small className="conv-topic">{props.subtitle}</small> : null}
          {props.project ? (
            <>
              <span className="sep" aria-hidden="true">
                /
              </span>
              <span className="crumb" title={props.project.path}>
                <Icon name="folder" />
                {props.project.name}
              </span>
            </>
          ) : null}
          <span className="grow" />
          {props.usage ? (
            <span className="tokens" title="Usage of this conversation">
              {props.usage}
            </span>
          ) : null}
          {props.onStop ? (
            <button
              type="button"
              className="btn sm danger"
              title="Stop the agent"
              data-tauri-drag-region="false"
              onClick={props.onStop}
            >
              Stop
            </button>
          ) : null}
          {props.actions}
        </header>
        {props.children}
      </div>
      {props.work}
      {searching && source && search ? (
        <Palette
          source={source}
          now={props.side.now}
          open={side.selectedChat ? { key: side.selectedChat, glyph: side.selectedGlyph } : undefined}
          onOpenChat={(chat) => latest.current.side.onOpenChat(chat)}
          onOpenSession={(session) => latest.current.search?.onOpenSession(session)}
          onClose={() => closeSearch()}
        />
      ) : null}
    </div>
  );
}
