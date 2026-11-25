import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '../../agents/sessions/group.js';
import { useEscape } from '../../react/escape.js';
import { paletteMove, paletteRows, paletteSearch, type PaletteItem, type PaletteSource } from '../palette.js';
import { sessionGlyph, sessionKey, type ChatGlyph } from '../sidebar.js';
import { Icon, StateGlyph } from './sidebar.js';

export interface PaletteProps {
  source: PaletteSource;
  /** Opens one of this app's chats. */
  onOpenChat(chat: SessionInfo): void;
  /** Goes to a session another agent has. */
  onOpenSession(session: SessionInfo): void;
  /**
   * Closes the palette and puts the focus back where it was. Called before a result opens, so what
   * opens may then take the focus for itself.
   */
  onClose(): void;
  /** The open chat (`sessionKey`) and its state as it is now, which beats what the stores last wrote. */
  open?: { key: string; glyph?: ChatGlyph };
  now?: number;
}

const KIND_TITLE = {
  chat: 'A chat of this app: Enter opens it',
  session: 'A session of another agent: Enter shows it in All sessions',
  command: 'A command: Enter runs it',
} as const;

/**
 * Search (⌘K): a palette over the page with this app's chats, the other agents' sessions and the
 * window's commands (docs/design/desktop-layout.md). The focus stays in the field: the arrows move
 * the selection, Enter opens it, Escape closes.
 */
export function Palette(props: PaletteProps) {
  const now = props.now ?? Date.now();
  const [query, setQuery] = useState('');
  /**
   * The row selected, by its key: a list refreshed under it (a chat moved up, a session ended) keeps
   * the same row selected, wherever it is now. Undefined, or a row no longer listed: the first.
   */
  const [selected, setSelected] = useState<string>();
  // Built when the source changes; typing only scores the rows.
  const rows = useMemo(() => paletteRows(props.source), [props.source]);
  const items = useMemo(() => paletteSearch(rows, query), [rows, query]);
  const index = Math.max(0, selected === undefined ? 0 : items.findIndex((item) => item.key === selected));
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEscape(true, props.onClose);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    // Not in every DOM a test runs in.
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [index, items]);

  const open = (item: PaletteItem | undefined) => {
    if (!item) return;
    props.onClose();
    if (item.kind === 'command') item.command.run();
    else if (item.kind === 'chat') props.onOpenChat(item.session);
    else props.onOpenSession(item.session);
  };

  return (
    <div
      className="palette-bg"
      data-tauri-drag-region="false"
      onMouseDown={(event) => {
        // A press beside the palette closes it; one inside must not take the focus from the field.
        if (event.target === event.currentTarget) props.onClose();
        else if (event.target !== field.current) event.preventDefault();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search chats and sessions">
        <input
          ref={field}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `palette-row-${index}` : undefined}
          aria-label="Search chats and sessions"
          placeholder="Search chats and sessions…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(undefined);
          }}
          onKeyDown={(event) => {
            // The field is all there is to focus here.
            if (event.key === 'Tab') return event.preventDefault();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              return open(items[index]);
            }
            // Home and End go to the first and last row, typed text or not: one line of search needs
            // no caret keys. With a modifier (Shift+Home selects) they stay the field's.
            const caret = event.key === 'Home' || event.key === 'End';
            if (caret && (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) return;
            const next = paletteMove(event.key, index, items.length);
            if (next === undefined) return;
            event.preventDefault();
            setSelected(items[next]!.key);
          }}
        />
        <div className="palette-res" id="palette-results" role="listbox" aria-label="Results" ref={list}>
          {items.map((item, at) => (
            <div
              key={item.key}
              id={`palette-row-${at}`}
              className="pres"
              role="option"
              aria-selected={at === index}
              title={
                item.kind === 'command'
                  ? KIND_TITLE.command
                  : `${KIND_TITLE[item.kind]}${(item.session.cwd ?? item.session.repository) ? `\n${item.session.cwd ?? item.session.repository}` : ''}`
              }
              onMouseMove={() => setSelected(item.key)}
              onClick={() => open(item)}
            >
              {item.kind === 'command' ? (
                <Icon name="chev" />
              ) : (
                <StateGlyph
                  state={
                    (sessionKey(item.session) === props.open?.key && props.open.glyph) ||
                    sessionGlyph(item.session, now)
                  }
                  decorative
                />
              )}
              <span className="grow">{item.title}</span>
              {item.kind === 'command' ? (
                item.command.shortcut ? (
                  <kbd>{item.command.shortcut}</kbd>
                ) : null
              ) : (
                <>
                  <span className="tag">{item.project}</span>
                  <span className="tag">{item.agent}</span>
                </>
              )}
              <small>{item.kind}</small>
            </div>
          ))}
          {items.length ? null : <p className="palette-none">No chat, session or command matches.</p>}
        </div>
        <div className="pfoot">
          ↑ ↓ move · Enter opens · Esc closes · searches titles and first and last prompt; each result names its project
          and agent
        </div>
      </div>
    </div>
  );
}
