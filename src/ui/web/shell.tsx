import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ownEscape } from '../../react/escape.js';
import { escapeAction, RAIL_BELOW_PX, startsCollapsed } from '../sidebar.js';
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

export interface ShellProps {
  /** The sidebar's content; the shell owns whether it is collapsed. */
  side: Omit<SidebarProps, 'collapsed' | 'onToggle'>;
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
  /** For tests: where the collapsed state is kept. Default `localStorage`. */
  store?: Store;
  children: ReactNode;
}

/**
 * The window: the sidebar on the left, and the slim top bar over the chat or a page. ⌘B folds the
 * sidebar to its rail (remembered; the rail is the default in a narrow window), ⌘N starts a chat,
 * ⌘K is Search, ⌘, opens Settings. Escape goes back from a page to the chat; it never reaches a running turn from here.
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

  // The window is this app's alone: an Escape that a menu, popover or viewer took reaches nothing else.
  useEffect(() => ownEscape(), []);

  useEffect(() => {
    // Until the person chooses, the width does: the rail below 980 px.
    const onResize = () => {
      if (readStore(latest.current.store) === null) setCollapsed(window.innerWidth < RAIL_BELOW_PX);
    };
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
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
      if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey)
        return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        toggle();
      } else if (key === 'n') {
        event.preventDefault();
        now.side.onNewChat();
      } else if (key === 'k') {
        event.preventDefault();
        now.side.onSearch?.();
      } else if (key === ',' && now.side.onSettings) {
        event.preventDefault();
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

  return (
    <div className={`shell${collapsed ? ' side-collapsed' : ''}`}>
      <Sidebar {...props.side} collapsed={collapsed} onToggle={toggle} />
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
          {props.actions}
        </header>
        {props.children}
      </div>
    </div>
  );
}
