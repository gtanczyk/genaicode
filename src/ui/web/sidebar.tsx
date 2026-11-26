import type { ChatSummary } from '../hub.js';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionInfo } from '../../agents/sessions/group.js';
import { useEscape } from '../../react/escape.js';
import { BUG_REPORT_URL, SUPPORT_URL } from '../../support.js';
import { ago } from '../sessions.js';
import {
  chatTitle,
  GLYPH_TITLE,
  sessionGlyph,
  sessionKey,
  type ChatGlyph,
  type ChatProject,
  type NeedsYou,
  type QuotaRow,
} from '../sidebar.js';

/** Where the Help menu's Terms item goes until there is a page of its own. */
export const TERMS_URL = 'https://github.com/gtanczyk/genaicode/blob/master/docs/legal.md';

const ICONS = {
  side: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6 3v10" />
    </>
  ),
  work: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M10 3v10" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M2 9.5 4 3h8l2 6.5V13H2z" />
      <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
    </>
  ),
  layers: (
    <>
      <path d="m8 2 6 3-6 3-6-3z" />
      <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.6-.8 1.2M8 11.3v.2" />
    </>
  ),
  down: <path d="M8 3v8M4.5 8 8 11.5 11.5 8M3 13.5h10" />,
  chev: <path d="m6 4 4 4-4 4" />,
  back: <path d="M10 4 6 8l4 4" />,
  dots: (
    <>
      <circle cx="3.5" cy="8" r=".6" />
      <circle cx="8" cy="8" r=".6" />
      <circle cx="12.5" cy="8" r=".6" />
    </>
  ),
  folder: <path d="M2 4.5h4l1.2 1.5H14V12.5H2z" />,
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12" />,
  doc: (
    <>
      <path d="M4 2h5.5L12 4.5V14H4z" />
      <path d="M9.5 2v2.5H12M6 8h4M6 10.5h4" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="6" r="2.3" />
      <path d="M1.8 13c.4-2.2 2-3.4 4.2-3.4s3.8 1.2 4.2 3.4M10.6 3.9a2.3 2.3 0 0 1 0 4.3M12.2 10c1.1.5 1.8 1.5 2 3" />
    </>
  ),
} as const;

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg className={`i${className ? ` ${className}` : ''}`} viewBox="0 0 16 16" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const GLYPHS: Record<ChatGlyph, ReactNode> = {
  wait: <circle cx="6" cy="6" r="3.5" strokeDasharray="1.8 1.8" />,
  run: <path d="M6 1.5A4.5 4.5 0 1 0 10.5 6" />,
  ask: <path d="M6 1 11 6 6 11 1 6z" fill="currentColor" />,
  err: <path d="m2.5 2.5 7 7M9.5 2.5l-7 7" />,
  ok: <path d="m2 6.5 2.8 2.8L10 3.5" />,
  idle: <circle cx="6" cy="6" r="3.5" />,
};

/** A state as a hue and a shape: running ring, needs-you diamond, failed cross, done check, idle circle. */
export function StateGlyph({ state, decorative }: { state: ChatGlyph; decorative?: boolean }) {
  return (
    <svg
      className={`sg ${state}`}
      viewBox="0 0 12 12"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': GLYPH_TITLE[state] })}
    >
      {GLYPHS[state]}
    </svg>
  );
}

/**
 * A menu that opens from its button: a click outside or Escape closes it, and Escape puts the focus
 * back on the button and goes no further (it must not also close the page behind or stop a turn).
 */
export function MenuButton({
  label,
  title,
  className,
  menuClassName,
  menuLabel,
  children,
  button,
}: {
  /** The accessible name of the button. */
  label: string;
  title?: string;
  className?: string;
  menuClassName?: string;
  menuLabel?: string;
  /** What the button shows. */
  button: ReactNode;
  /** The items; called with a function that closes the menu. */
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);
  useEscape(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  return (
    <span className="menu-anchor" ref={wrap} data-tauri-drag-region="false">
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        {button}
      </button>
      {open ? (
        <div
          className={`menu${menuClassName ? ` ${menuClassName}` : ''}`}
          data-popup
          role="menu"
          aria-label={menuLabel ?? label}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </span>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggle(): void;
  /** Which entry is the page shown: a nav item, or the chat (then `selectedChat` marks its row). */
  page: 'chat' | 'sessions' | 'chats' | 'inbox' | 'settings';
  onNewChat(): void;
  /** Opens Search, the ⌘K palette. Absent (a window with nothing to search): the button says so and does nothing. */
  onSearch?(): void;
  needs: NeedsYou;
  onNeedsYou(): void;
  /** Absent when the page has no session index (`/api/sessions`). */
  onAllSessions?(): void;
  /**
   * Every chat of this app: the list here ends after 30 days and leaves out the archived, so this is
   * the way to the rest. Absent when the page has no session index.
   */
  onAllChats?(): void;
  /** This app's chats by directory, the recent ones. */
  projects: readonly ChatProject[];
  /** `sessionKey` of the open chat's row. */
  selectedChat?: string;
  /** The open chat's state as it is now; other rows show what the stores say. */
  selectedGlyph?: ChatGlyph;
  live?: readonly ChatSummary[];
  limit?: number;
  onStop?(chat: ChatSummary): void;
  onOpenChat(chat: SessionInfo): void;
  /**
   * The title of the open chat while its turn runs: the window has one session, so other chats and
   * new ones only open when it finishes. Their rows, New chat and the projects' + look unavailable
   * and say so; a click still reaches the handlers, which say why and offer to stop the turn.
   */
  busyWith?: string;
  /** Start a chat in a project's directory. Absent: the headings have no button. */
  onNewChatIn?(project: ChatProject): void;
  /** Whether a chat can start in that project. Default: in every one. */
  canNewChatIn?(project: ChatProject): boolean;
  /** The latest sessions this app did not start, and how many there are. */
  others?: { shown: readonly SessionInfo[]; total: number };
  /** A newer version of the app: downloading, or ready to install on a relaunch. */
  update?: { version: string; ready: boolean; installing?: boolean };
  relaunching?: boolean;
  onRelaunch?(): void;
  quota: readonly QuotaRow[];
  onQuota?(): void;
  /** Opens the Settings page (⌘,). Absent: no Settings button. */
  onSettings?(): void;
  /** The version in the Help menu and beside the connection state. */
  version?: string;
  /** The release notes were not opened yet: a quiet dot on Help. */
  whatsNewUnread?: boolean;
  onWhatsNew?(): void;
  /** Lists the commands and keys in the chat (`/help`). */
  onCommands?(): void;
  connected: boolean;
  now?: number;
}

/**
 * The left sidebar of the window (docs/design/desktop-layout.md): New chat, Search, Needs you, All
 * sessions, this app's chats by project, the other agents' sessions, and at the bottom the update,
 * the plan limits, Settings, Help and the connection. Collapsed it is a 56 px icon rail.
 */
export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const now = props.now ?? Date.now();
  const { needs, update } = props;
  const worst = props.quota.find((row) => row.percent !== undefined);
  const quotaTitle = props.quota.map((row) => row.title).join('\n');
  const held = props.busyWith !== undefined ? `Opens when ${props.busyWith} finishes` : undefined;
  return (
    <aside className="side" aria-label="Sidebar">
      <div className="side-top" data-tauri-drag-region="deep">
        <span className="brand">
          <img src="/assets/wolf-64.png" alt="" /> genaicode
        </span>
        <span className="grow" />
        <button
          type="button"
          className="btn ghost icon sm side-toggle"
          title="Collapse sidebar (⌘B)"
          aria-label="Collapse sidebar"
          aria-expanded={!props.collapsed}
          data-tauri-drag-region="false"
          onClick={props.onToggle}
        >
          <Icon name="side" />
        </button>
      </div>
      <div className="side-actions">
        <button
          type="button"
          className={`nav new${held ? ' unavailable' : ''}`}
          title={held ?? 'New chat (⌘N)'}
          aria-label="New chat"
          aria-disabled={held ? true : undefined}
          onClick={props.onNewChat}
        >
          <Icon name="plus" />
          <span className="label grow">New chat</span>
          <kbd>⌘N</kbd>
        </button>
        <button
          type="button"
          className="nav"
          title={props.onSearch ? 'Search chats and sessions (⌘K)' : 'Search is not available in this window'}
          aria-label="Search"
          aria-haspopup={props.onSearch ? 'dialog' : undefined}
          aria-disabled={props.onSearch ? undefined : true}
          onClick={props.onSearch}
        >
          <Icon name="search" />
          <span className="label grow">Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="nav"
          title={needs.title}
          aria-label={needs.total ? `Needs you, ${needs.total}` : 'Needs you'}
          aria-current={props.page === 'inbox' ? 'page' : undefined}
          onClick={props.onNeedsYou}
        >
          <Icon name="inbox" />
          <span className="label grow">Needs you</span>
          {needs.total ? <span className="count hot">{needs.total}</span> : null}
        </button>
        {props.onAllSessions ? (
          <button
            type="button"
            className="nav"
            title="Sessions of every agent on this machine"
            aria-label="All sessions"
            aria-current={props.page === 'sessions' ? 'page' : undefined}
            onClick={props.onAllSessions}
          >
            <Icon name="layers" />
            <span className="label grow">All sessions</span>
          </button>
        ) : null}
      </div>
      <nav className="side-scroll" aria-label="Chats">
        {props.projects.length ? (
          <div className="group-h" title="A project is a directory">
            Chats by project
          </div>
        ) : null}
        {props.projects.map((project) => (
          <details className="proj" key={project.key} open>
            <summary title={project.path ?? project.name}>
              <Icon name="chev" className="chev" />
              <span className="grow">{project.name}</span>
              {props.onNewChatIn && (props.canNewChatIn?.(project) ?? true) ? (
                <button
                  type="button"
                  className={`btn ghost icon sm add${held ? ' unavailable' : ''}`}
                  title={held ?? `New chat here: ${project.path ?? project.name}`}
                  aria-disabled={held ? true : undefined}
                  aria-label={`New chat here, ${project.name}`}
                  onClick={(event) => {
                    // The heading folds on a click; the button on it does not.
                    event.preventDefault();
                    event.stopPropagation();
                    props.onNewChatIn?.(project);
                  }}
                >
                  <Icon name="plus" />
                </button>
              ) : null}
            </summary>
            {project.chats.map((chat) => {
              const key = sessionKey(chat);
              const selected = props.page === 'chat' && key === props.selectedChat;
              const live = props.live?.find((row) => sessionKey(row) === key);
              const glyph =
                live?.glyph || (key === props.selectedChat && props.selectedGlyph) || sessionGlyph(chat, now);
              const unavailable = held && key !== props.selectedChat ? held : undefined;
              const row = (
                <button
                  type="button"
                  key={key}
                  className={`nav chat${unavailable ? ' unavailable' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  aria-disabled={unavailable ? true : undefined}
                  title={
                    unavailable ??
                    (live?.interrupted ? 'Interrupted when the app quit' : undefined) ??
                    `${chat.agent}${chat.cwd ? ` · ${chat.cwd}` : ''}`
                  }
                  onClick={() => props.onOpenChat(chat)}
                >
                  <StateGlyph state={glyph} />
                  <span className="grow">{live?.unread ? <strong>{chatTitle(chat)}</strong> : chatTitle(chat)}</span>
                  <small>{glyph === 'run' || now - chat.updatedAt < 60_000 ? 'now' : ago(now - chat.updatedAt)}</small>
                </button>
              );
              return live?.turnInProgress && !selected ? (
                <div key={key} className="chat-actions">
                  {row}
                  <button type="button" aria-label={'Stop ' + chatTitle(chat)} onClick={() => props.onStop?.(live)}>
                    Stop
                  </button>
                </div>
              ) : (
                row
              );
            })}
          </details>
        ))}
        {props.limit && props.live?.some((row) => row.turnInProgress) ? (
          <small>
            {props.live.filter((row) => row.turnInProgress).length} of {props.limit} running
          </small>
        ) : null}
        {props.onAllChats ? (
          <button
            type="button"
            className="nav chat all"
            aria-label="All chats"
            aria-current={props.page === 'chats' ? 'page' : undefined}
            title="Every chat of this app: the older than 30 days and the archived too"
            onClick={props.onAllChats}
          >
            <span className="grow">All chats</span>
            <Icon name="chev" />
          </button>
        ) : null}
        {props.others?.shown.length && props.onAllSessions ? (
          <section className="other" aria-label="Other agents' sessions">
            <div className="group-h">Other agents’ sessions</div>
            {props.others.shown.map((session) => (
              <button
                type="button"
                key={sessionKey(session)}
                className="nav chat"
                title={`${session.agent}${session.cwd ? ` · ${session.cwd}` : ''}`}
                onClick={props.onAllSessions}
              >
                <StateGlyph state={sessionGlyph(session, now)} />
                <span className="grow">{chatTitle(session)}</span>
                <span className="tag">{session.agent}</span>
              </button>
            ))}
            <button type="button" className="nav chat all" onClick={props.onAllSessions}>
              <span className="grow">Show all {props.others.total} sessions</span>
              <Icon name="chev" />
            </button>
          </section>
        ) : null}
      </nav>
      <div className="side-foot">
        {update ? (
          <button
            type="button"
            className="update"
            disabled={!update.ready || props.relaunching}
            title={
              update.installing
                ? `Version ${update.version} is being installed. The app starts again in a moment.`
                : update.ready
                  ? `Version ${update.version} is downloaded. Relaunching installs it and stops the agents this app runs.`
                  : `Version ${update.version} is downloading. Nothing installs before you choose it.`
            }
            onClick={props.onRelaunch}
          >
            <Icon name="down" />
            <span>
              {props.relaunching || update.installing
                ? 'Relaunching…'
                : update.ready
                  ? `Install ${update.version} and relaunch`
                  : 'Downloading update…'}
            </span>
          </button>
        ) : null}
        {props.quota.length ? (
          <button
            type="button"
            className="quota"
            aria-label="Plan limits"
            title={`Plan limits, the worst window of each agent.\n${quotaTitle}`}
            onClick={props.onQuota}
            disabled={!props.onQuota}
          >
            <span
              className="ring"
              data-level={worst?.level ?? 'ok'}
              style={{ ['--used' as string]: `${worst?.percent ?? 0}%` }}
            >
              <b>{worst?.level === 'exceeded' ? '!' : (worst?.percent ?? '–')}</b>
            </span>
            {props.quota.map((row) => (
              <span className="quota-row" key={row.agent} data-level={row.level}>
                <span>{row.agent}</span>
                <span className="meter">
                  <i style={{ width: `${row.percent ?? 0}%` }} />
                </span>
                <span>{row.text}</span>
              </span>
            ))}
          </button>
        ) : null}
        <div className="foot-row">
          {props.onSettings ? (
            // Half of the row, as the Help menu beside it.
            <span className="foot-item" data-tauri-drag-region="false">
              <button
                type="button"
                className="nav"
                title="Settings (⌘,)"
                aria-label="Settings"
                aria-current={props.page === 'settings' ? 'page' : undefined}
                onClick={props.onSettings}
              >
                <Icon name="gear" />
                <span className="label grow">Settings</span>
              </button>
            </span>
          ) : null}
          <MenuButton
            label="Help"
            title="Help and what's new"
            className="nav"
            menuClassName="up"
            button={
              <>
                <Icon name="help" />
                <span className="label grow">Help</span>
                {props.whatsNewUnread ? <span className="badge-dot" title={`New in ${props.version ?? ''}`} /> : null}
              </>
            }
          >
            {(close) => (
              <>
                {props.onWhatsNew ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        props.onWhatsNew?.();
                      }}
                    >
                      <span className="grow">What’s new</span>
                      {props.version ? <span className="pill">{props.version}</span> : null}
                    </button>
                    <hr />
                  </>
                ) : null}
                <a role="menuitem" href={SUPPORT_URL} target="_blank" rel="noreferrer" onClick={close}>
                  Get help
                </a>
                <a role="menuitem" href={BUG_REPORT_URL} target="_blank" rel="noreferrer" onClick={close}>
                  Report a bug
                </a>
                <a role="menuitem" href={TERMS_URL} target="_blank" rel="noreferrer" onClick={close}>
                  Terms
                </a>
                {props.onCommands ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      props.onCommands?.();
                    }}
                  >
                    Commands and keys
                  </button>
                ) : null}
              </>
            )}
          </MenuButton>
        </div>
        <div
          className={`conn${props.connected ? '' : ' off'}`}
          title={props.connected ? 'Connected to the genaicode server' : 'Disconnected from the genaicode server'}
        >
          <StateGlyph state={props.connected ? 'ok' : 'err'} decorative />
          <span>
            {props.connected ? 'Connected' : 'Disconnected'}
            {props.version ? ` · ${props.version}` : ''}
          </span>
        </div>
      </div>
    </aside>
  );
});
