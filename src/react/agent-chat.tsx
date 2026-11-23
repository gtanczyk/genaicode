import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { SessionEntry, SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalDecision, Artifact, QuestionAnswers } from '../agents/types.js';
import { answerSummary, QuestionCard } from './question-card.js';
import { describeFailover } from '../agents/failover.js';
import { PendingAttachments, TurnAttachments, useAttachments, type ChatAttachments } from './attachments.js';
import { useFollowScroll } from './follow-scroll.js';
import {
  formatBytes,
  formatDuration,
  formatUsage,
  limitChips,
  relativePath,
  shortId,
  toolArgument,
  toolDiff,
  toolLabel,
  toolPath,
  turnFooter,
  type ToolDiff,
} from './format.js';
import { Markdown, readFileLinkPosition, type FilePosition } from './markdown.js';
import { PackTasks, type PackActionHandler } from './pack-tasks.js';
import { SessionRelayCard, type ChatSessionRelay } from './session-relay.js';
import {
  artifactKindLabel,
  ArtifactSubmitBar,
  canPreviewArtifact,
  useArtifactSubmit,
  withDownloadParam,
  type SubmitArtifact,
} from './artifact-panel.js';

/** A line from the host itself (not the agent), shown between turns. */
export interface ChatNotice {
  /** Stable key. */
  id: string | number;
  /** Shown after this many turns: 0 before the first turn, `state.turns.length` at the end. */
  afterTurn: number;
  text: ReactNode;
  tone?: 'info' | 'error';
  /** Live card for a message relayed to another session (`sessions_send`). */
  relay?: ChatSessionRelay;
}

/** A command the composer offers to complete. */
export interface ChatCompletion {
  /** What is typed, with its prefix: `/model`. */
  name: string;
  /** Its arguments, as a hint: `[id]`. Completing a command with arguments leaves a space to type them. */
  args?: string;
  help?: string;
}

export interface AgentChatProps {
  /**
   * The session to show, e.g. `session.get()` sent over SSE. Null or undefined (no session
   * yet) shows an empty, idle chat the user can type into.
   */
  state: SessionState | null | undefined;
  /**
   * The user sent `text` (Enter or the Send button). Whitespace-only input is not sent, unless
   * files go with it: `files` is there when `attachments` is on and the user attached some.
   * A promise that resolves to false says the message was not sent: the composer takes the
   * text and the files back for another try, unless the user started another message meanwhile.
   */
  onSend(text: string, files?: File[]): void | Promise<boolean | void>;
  /**
   * Let the user send files with a prompt: an attach button, paste and drop, and with `voice` a
   * microphone that records a voice message. Without it the composer takes text only. The host
   * decides what an agent can do with a file, so set `accept` to what it handles.
   */
  attachments?: ChatAttachments;
  /** The user pressed Stop or Esc while the agent works. Without it there is no Stop button. */
  onStop?(): void;
  /** Offer Stop (button and Esc) while the agent is idle too: the host runs something of its own. */
  canStop?: boolean;
  /**
   * Answer an approval the agent asked for (`state.approvals`). Without it pending approvals
   * show as waiting, with no buttons.
   */
  onApprove?(id: string, decision: ApprovalDecision): void;
  /**
   * Answer a question the agent asked (a request of `kind: 'question'` in `state.approvals`):
   * the chosen option labels or typed text per question id. Skip goes to `onApprove(id, 'deny')`.
   * Without it a question shows as waiting, with its options disabled.
   */
  onAnswer?(id: string, answers: QuestionAnswers): void;
  /**
   * Approve pending requests and turn on auto-approve for future requests in this session.
   * Shown beside Approve and Deny when `onApprove` is also set.
   */
  onAutoApprove?(): void;
  /** Control a delegated task in its owning turn. Without this, pack tasks are read-only. */
  onPackAction?: PackActionHandler;
  /**
   * How a prompt bubble shows the text that was sent, e.g. to hide a context prefix the host
   * added. Return null to hide the bubble. `turn` is undefined for queued prompts and for
   * input sent while the agent works.
   */
  renderPrompt?(text: string, turn?: SessionTurn): ReactNode;
  /**
   * Makes the file paths in the transcript (edited files, the file a tool step read or changed,
   * a link to a file in a reply) buttons: called with the path as the agent gave it, usually absolute,
   * and an optional `:line` / `#L12-L20` position when the link carried one. The host shows the file.
   */
  onOpenFile?(path: string, position?: FilePosition): void;
  /**
   * Adds a right-click **Reveal** action on file links in the transcript (e.g. Reveal in Finder in
   * the desktop app).
   */
  onRevealFile?(path: string): void;
  /** Tool name as shown, e.g. without an MCP server prefix. Default: friendlier names for common tools. */
  formatToolName?(name: string): string;
  /**
   * Where the host serves an artifact's content (`store.read()` with `artifactResponse()`, whose
   * headers keep agent-written HTML away from this page). Without it artifacts show as a card
   * with no preview. Put `artifact.version` in the URL so a new version reloads.
   */
  artifactUrl?(artifact: Artifact): string | undefined;
  /**
   * Opens an artifact in the host's viewer panel when **Open** is clicked on the card, instead of
   * expanding a preview inline in the transcript. Without it the card previews inline as before.
   */
  onOpenArtifact?(artifact: Artifact): void;
  /**
   * Resolve a local path referenced by `![alt](path)` in an agent reply to an image URL (e.g. a
   * capability URL for image files only). Clicking the thumbnail opens it through `onOpenFile`.
   * Without it, or when undefined is returned, the image renders as a file link.
   */
  imageUrl?(path: string): string | undefined;
  /**
   * How remote `![alt](https://...)` images in replies load: `'click'` (default, click-to-load
   * chip so replies cannot trigger unsolicited requests) or `'load'`.
   */
  remoteImages?: 'click' | 'load';
  /** Replaces the default artifact card. Return undefined to keep the default. */
  renderArtifact?(artifact: Artifact, url: string | undefined): ReactNode;
  /**
   * A page the agent published asked to send `data` back (a filled-in form, a choice) and the
   * user confirmed it on the card. Default: `onSend(artifactSubmission(artifact, data))`, so the
   * agent gets it as the user's next message. Pass null to let no page send anything.
   */
  onArtifactSubmit?: ((artifact: Artifact, data: unknown) => void) | null;
  /** Host content after a turn (approval cards, links...). */
  renderAfterTurn?(turn: SessionTurn, index: number): ReactNode;
  /** Host content at the end of the transcript, after the last turn. */
  renderFooter?(): ReactNode;
  /** Host lines between turns. */
  notices?: readonly ChatNotice[];
  /**
   * Fold a turn's work (tools, edits, interim text) into one "N steps" line that opens on
   * click, leaving the answer, errors, steering input and open approvals in view. Default false.
   */
  foldSteps?: boolean;
  /** Replaces the default header (agent, model, session, usage). Pass null for no header. */
  header?: ReactNode;
  /** Extra content at the right end of the default header. */
  headerExtras?: ReactNode;
  /** Shown while there are no turns. Default: "What should <agent> work on?". */
  emptyState?: ReactNode;
  /** Composer placeholder. Default depends on the state (idle, steer, queue). */
  placeholder?: string;
  /**
   * Commands the host understands (`/help`...), offered while the message is the start of one:
   * arrows choose, Tab or Enter completes, Escape closes the list. The host still gets the text
   * through `onSend`.
   */
  completions?: readonly ChatCompletion[];
  /**
   * Host controls in a row under the message field: what the next prompt runs with (agent, model,
   * mode). The attach buttons move to that row too, so the field holds the text and Send only.
   */
  composerExtras?: ReactNode;
  /** Line under the composer. Default: the keys. Pass null for none. */
  hint?: ReactNode;
  /** A tooltip on the message box, e.g. its keys when `hint` is `null`. */
  composerTitle?: string;
  /** Keep the user from sending (the box stays editable), e.g. while the host is disconnected. */
  disabled?: boolean;
  autoFocus?: boolean;
  /** 'auto' follows prefers-color-scheme. Default 'auto'. */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
}

/**
 * A presentational chat with a coding agent: it renders the `SessionState` it is given and
 * reports what the user does through callbacks. It runs nothing, fetches nothing and holds no
 * token; the host owns the `AgentSession`. Import `genaicode/react/styles.css` once.
 */
/** The host's `onOpenFile`, for the entries deep in the transcript. */
const OpenFile = createContext<AgentChatProps['onOpenFile']>(undefined);
/** The host's `onAnswer`, for the question cards deep in the transcript. */
const AnswerQuestion = createContext<AgentChatProps['onAnswer']>(undefined);
/** Image options for Markdown replies deep in the transcript. */
const MarkdownConfig = createContext<{
  imageUrl?: AgentChatProps['imageUrl'];
  remoteImages?: AgentChatProps['remoteImages'];
}>({});

export function AgentChat(props: AgentChatProps) {
  const state = props.state ?? NO_SESSION;
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const running = state?.status === 'running';
  const relayWorking = !!props.notices?.some((notice) => notice.relay?.status === 'working');
  const now = useNow(running || relayWorking);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [draft]);

  const { onSend, onArtifactSubmit, disabled } = props;
  // Nothing is sent while the host keeps the user from sending.
  const submitArtifact: SubmitArtifact | undefined =
    onArtifactSubmit === null || disabled
      ? undefined
      : (onArtifactSubmit ?? ((artifact, data) => onSend(artifactSubmission(artifact, data))));
  const rootClass = ['gc-chat', props.onOpenFile && 'gc-opens-files', props.className].filter(Boolean).join(' ');
  const { onOpenFile, onRevealFile } = props;
  const theme = props.theme && props.theme !== 'auto' ? props.theme : undefined;
  const agentName = state.agent || 'the agent';
  const [fileMenu, setFileMenu] = useState<{ path: string; position?: FilePosition; x: number; y: number }>();
  useEffect(() => {
    if (!fileMenu) return;
    const dismiss = () => setFileMenu(undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      dismiss();
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [fileMenu]);

  const attached = useAttachments(props.attachments);
  const picker = useRef<HTMLInputElement>(null);
  const sendable = (!!draft.trim() || attached.files.length > 0) && !props.disabled && !attached.recording;
  // What is in the composer now, for an answer that comes later.
  const composing = useRef({ draft, files: attached.files });
  composing.current = { draft, files: attached.files };
  const send = () => {
    if (!sendable) return;
    follow();
    const sent = { draft, files: attached.files };
    const outcome = sent.files.length ? props.onSend(draft, sent.files) : props.onSend(draft);
    setDraft('');
    setClosedAt(undefined);
    attached.clear();
    // A host that could not send gives the message back, unless another was started meanwhile.
    if (outcome instanceof Promise) {
      void outcome.then(
        (ok) => {
          // A message started meanwhile is left alone: the two are never mixed.
          if (ok !== false || composing.current.draft || composing.current.files.length) return;
          setDraft(sent.draft);
          if (sent.files.length) attached.add(sent.files);
        },
        () => undefined,
      );
    }
  };
  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!attached.enabled || !event.clipboardData.files.length) return;
    // A copied image comes as a file; pasted text goes into the box as usual.
    event.preventDefault();
    attached.add(event.clipboardData.files);
  };
  // Anywhere on the chat: a file dropped beside the box would otherwise replace the page.
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!attached.enabled || !event.dataTransfer.files.length) return;
    event.preventDefault();
    attached.add(event.dataTransfer.files);
  };
  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (attached.enabled && event.dataTransfer.types.includes('Files')) event.preventDefault();
  };
  const extras = props.composerExtras;
  const hasExtras = extras !== undefined && extras !== null && extras !== false;
  // Host controls take a row of their own under the field, with the attach buttons; without them
  // the attach buttons sit inside the field, under the text.
  const stacked = attached.enabled && !hasExtras;
  // Commands whose name the message starts, while it is one word and not yet one of them.
  const [picked, setPicked] = useState(0);
  const [closedAt, setClosedAt] = useState<string>();
  const offered =
    // A whole command is sent as typed, even when it starts a longer one.
    props.completions &&
    draft &&
    !/\s/.test(draft) &&
    closedAt !== draft &&
    !props.completions.some((one) => one.name === draft)
      ? props.completions.filter((one) => one.name.startsWith(draft))
      : [];
  const choice = offered[Math.min(picked, offered.length - 1)];
  // The list is shorter than a host's commands: the chosen one stays in view.
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const chosen = useRef<HTMLLIElement>(null);
  const chosenName = choice?.name;
  useEffect(() => {
    chosen.current?.scrollIntoView?.({ block: 'nearest' });
  }, [chosenName]);
  const complete = (one: ChatCompletion) => {
    setDraft(one.args ? `${one.name} ` : one.name);
    setPicked(0);
    input.current?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (choice && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : offered.length - 1;
        setPicked((Math.min(picked, offered.length - 1) + step) % offered.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        complete(choice);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setClosedAt(draft);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape' && (running || props.canStop) && props.onStop) props.onStop();
  };

  // Notices sit after the turn that was last when they were posted.
  const items: ReactNode[] = [];
  const toolName = props.formatToolName ?? toolLabel;
  const notices = [...(props.notices ?? [])].sort((a, b) => a.afterTurn - b.afterTurn);
  const flush = (upTo: number) => {
    while (notices.length && notices[0].afterTurn <= upTo) {
      const notice = notices.shift()!;
      items.push(
        notice.relay ? (
          <SessionRelayCard
            key={`n${notice.id}`}
            relay={notice.relay}
            cwd={state.cwd}
            now={now}
            toolName={toolName}
            imageUrl={props.imageUrl}
            remoteImages={props.remoteImages}
          />
        ) : (
          <div key={`n${notice.id}`} className={`gc-notice${notice.tone === 'error' ? ' gc-err' : ''}`}>
            {notice.text}
          </div>
        ),
      );
    }
  };
  state.turns.forEach((turn, index) => {
    flush(index);
    items.push(
      <Turn
        key={turn.id}
        turn={turn}
        now={now}
        cwd={state.cwd}
        pending={turn.result ? [] : state.approvals}
        onApprove={props.onApprove}
        onAutoApprove={props.onAutoApprove}
        onPackAction={props.disabled ? undefined : props.onPackAction}
        prompt={props.renderPrompt}
        toolName={props.formatToolName ?? toolLabel}
        artifactUrl={props.artifactUrl}
        onOpenArtifact={props.onOpenArtifact}
        renderArtifact={props.renderArtifact}
        submitArtifact={submitArtifact}
        fold={props.foldSteps ?? false}
      />,
    );
    const after = props.renderAfterTurn?.(turn, index);
    if (after !== undefined && after !== null && after !== false) {
      items.push(
        <div key={`a${turn.id}`} className="gc-after-turn">
          {after}
        </div>,
      );
    }
  });
  flush(Number.MAX_SAFE_INTEGER);
  // `items` is new on every render, so each render scrolls to the end while the user is there.
  const { ref: scroller, onScroll, follow } = useFollowScroll(items, 80);

  const placeholder =
    props.placeholder ??
    (running
      ? state.canSteer
        ? 'Add to the running task…'
        : 'Queue the next prompt…'
      : `Ask ${agentName} to change something…`);
  const usage = formatUsage(state.usage, state.costUsd);
  const limits = limitChips(state);
  const footer = props.renderFooter?.();

  const attachButtons = attached.enabled ? (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={attached.accept}
        onChange={(event) => {
          if (event.target.files) attached.add(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        className="gc-btn gc-icon"
        aria-label="Attach files"
        title="Attach files (or paste, or drop them here)"
        disabled={attached.files.length >= attached.max}
        onClick={() => picker.current?.click()}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {attached.canRecord ? (
        <button
          type="button"
          className={`gc-btn gc-icon${attached.recording ? ' gc-recording' : ''}`}
          aria-label={attached.recording ? 'Stop recording' : 'Record a voice message'}
          aria-pressed={attached.recording}
          title={attached.recording ? 'Stop recording' : 'Record a voice message'}
          disabled={!attached.recording && attached.files.length >= attached.max}
          onClick={() => void attached.toggleRecording()}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11.5a6.5 6.5 0 0013 0M12 18v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </>
  ) : null;

  const onFileContextMenu = onRevealFile
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        const el = (event.target as Element).closest?.('[data-gc-file]');
        const path = el?.getAttribute('data-gc-file');
        if (!el || !path) return;
        event.preventDefault();
        setFileMenu({
          path,
          position: readFileLinkPosition(el),
          x: Math.min(event.clientX, Math.max(8, window.innerWidth - 200)),
          y: Math.min(event.clientY, Math.max(8, window.innerHeight - 96)),
        });
      }
    : undefined;

  return (
    <MarkdownConfig.Provider value={{ imageUrl: props.imageUrl, remoteImages: props.remoteImages }}>
      <AnswerQuestion.Provider value={props.onAnswer}>
        <OpenFile.Provider value={props.onOpenFile}>
          <div
            className={rootClass}
            data-theme={theme}
            data-status={state.status}
            style={props.style}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onContextMenu={onFileContextMenu}
            // A file link or local image thumbnail (`data-gc-file`, from Markdown) opens like any other path.
            onClick={
              onOpenFile
                ? (event) => {
                    const el = (event.target as Element).closest?.('[data-gc-file]');
                    const path = el?.getAttribute('data-gc-file');
                    if (!el || !path) return;
                    const position = readFileLinkPosition(el);
                    if (position) onOpenFile(path, position);
                    else onOpenFile(path);
                  }
                : undefined
            }
          >
            {props.header !== undefined ? (
              props.header
            ) : (
              <div className="gc-header">
                {state.agent ? (
                  <span className="gc-avatar" aria-hidden="true">
                    {state.agent.slice(0, 2)}
                  </span>
                ) : null}
                <b className="gc-agent">{state.agent || 'Agent'}</b>
                {state.model ? <span className="gc-model">{state.model}</span> : null}
                {running ? <span className="gc-spin" role="status" aria-label="Working" /> : null}
                <span className="gc-spacer" />
                {state.sessionId ? <span className="gc-chip">session {shortId(state.sessionId)}</span> : null}
                {usage ? <span className="gc-chip">{usage}</span> : null}
                {limits.map((chip) => (
                  <span key={chip.key} className="gc-chip gc-limit" data-level={chip.level} title={chip.title}>
                    {chip.text}
                  </span>
                ))}
                {props.headerExtras}
              </div>
            )}
            <div className="gc-scroll" ref={scroller} onScroll={onScroll}>
              <div className="gc-thread" role="log" aria-live="polite">
                {state.turns.length === 0
                  ? (props.emptyState ?? (
                      <div className="gc-empty">
                        <div className="gc-empty-title">What should {agentName} work on?</div>
                      </div>
                    ))
                  : null}
                {items}
                {footer !== undefined && footer !== null && footer !== false ? (
                  <div className="gc-footer-slot">{footer}</div>
                ) : null}
              </div>
            </div>
            <div className="gc-composer">
              {state.queued.length ? (
                <div className="gc-queued">
                  {state.queued.map((prompt, i) => {
                    const shown = props.renderPrompt ? props.renderPrompt(prompt) : prompt;
                    return shown === null || shown === undefined || shown === false ? null : (
                      <span key={i}>⏸ {shown}</span>
                    );
                  })}
                </div>
              ) : null}
              {choice ? (
                <ul className="gc-completions" id={listId} role="listbox" aria-label="Commands">
                  {offered.map((one, index) => (
                    <li
                      key={one.name}
                      id={optionId(index)}
                      ref={one === choice ? chosen : undefined}
                      role="option"
                      aria-selected={one === choice}
                      // Before the box loses focus.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        complete(one);
                      }}
                    >
                      <span className="gc-completion-name">
                        <b>{one.name}</b>
                        {one.args ? <code>{one.args}</code> : null}
                      </span>
                      {one.help ? <span className="gc-completion-help">{one.help}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {attached.enabled ? <PendingAttachments files={attached.files} onRemove={attached.remove} /> : null}
              {attached.problem ? (
                <div className="gc-attach-problem" role="alert">
                  {attached.problem}
                </div>
              ) : null}
              <div className={stacked ? 'gc-box gc-stacked' : 'gc-box'}>
                <textarea
                  ref={input}
                  rows={1}
                  autoFocus={props.autoFocus}
                  value={draft}
                  placeholder={placeholder}
                  title={props.composerTitle}
                  aria-label="Message"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setPicked(0);
                    setClosedAt(undefined);
                  }}
                  aria-autocomplete={props.completions ? 'list' : undefined}
                  role={props.completions ? 'combobox' : undefined}
                  aria-expanded={props.completions ? !!choice : undefined}
                  aria-controls={choice ? listId : undefined}
                  aria-activedescendant={choice ? optionId(offered.indexOf(choice)) : undefined}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                />
                {hasExtras ? null : attachButtons}
                {stacked ? <span className="gc-grow" /> : null}
                {(running || props.canStop) && props.onStop ? (
                  <button type="button" className="gc-btn gc-danger" onClick={() => props.onStop?.()}>
                    Stop
                  </button>
                ) : null}
                <button type="button" className="gc-btn gc-primary" disabled={!sendable} onClick={send}>
                  {running ? (state.canSteer ? 'Steer' : 'Queue') : 'Send'}
                </button>
              </div>
              {hasExtras ? (
                <div className="gc-under">
                  {attachButtons}
                  <span className="gc-grow" />
                  {extras}
                </div>
              ) : null}
              {props.hint === null ? null : (
                <div className="gc-hint">
                  {props.hint ?? `Enter to send · Shift+Enter for a new line${props.onStop ? ' · Esc stops' : ''}`}
                </div>
              )}
            </div>
            {fileMenu && onRevealFile ? (
              <div
                className="gc-context-menu"
                role="menu"
                style={{ left: fileMenu.x, top: fileMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                {onOpenFile ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const { path, position } = fileMenu;
                      setFileMenu(undefined);
                      if (position) onOpenFile(path, position);
                      else onOpenFile(path);
                    }}
                  >
                    Open
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const { path } = fileMenu;
                    setFileMenu(undefined);
                    onRevealFile(path);
                  }}
                >
                  {/Mac/.test(navigator.platform) ? 'Reveal in Finder' : 'Reveal in file manager'}
                </button>
              </div>
            ) : null}
          </div>
        </OpenFile.Provider>
      </AnswerQuestion.Provider>
    </MarkdownConfig.Provider>
  );
}

const NO_SESSION: SessionState = {
  agent: '',
  cwd: '',
  status: 'idle',
  turns: [],
  queued: [],
  approvals: [],
  usage: {},
  canSteer: false,
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Turn({
  turn,
  now,
  cwd,
  pending,
  onApprove,
  onAutoApprove,
  onPackAction,
  prompt,
  toolName,
  artifactUrl,
  onOpenArtifact,
  renderArtifact,
  submitArtifact,
  fold,
}: {
  artifactUrl?: AgentChatProps['artifactUrl'];
  onOpenArtifact?: AgentChatProps['onOpenArtifact'];
  renderArtifact?: AgentChatProps['renderArtifact'];
  submitArtifact?: SubmitArtifact;
  turn: SessionTurn;
  now: number;
  cwd: string;
  pending: SessionState['approvals'];
  onApprove?: AgentChatProps['onApprove'];
  onAutoApprove?: AgentChatProps['onAutoApprove'];
  onPackAction?: PackActionHandler;
  prompt?: AgentChatProps['renderPrompt'];
  toolName: (name: string) => string;
  fold: boolean;
}) {
  const running = !turn.result;
  const speaker = turn.pack?.lead ?? turn.agent;
  const bad = turn.result && !turn.result.ok;
  const shown = prompt ? prompt(turn.prompt, turn) : turn.prompt;
  const entry = (item: SessionEntry, i: number) => (
    <Entry
      key={i}
      entry={item}
      agent={
        item.kind === 'approval' && turn.pack
          ? (turn.pack.tasks.find((task) => task.id === item.request.subtaskId)?.agent ?? turn.pack.lead)
          : (turn.pack?.lead ?? turn.agent)
      }
      cwd={cwd}
      pending={pending}
      onApprove={onApprove}
      onAutoApprove={onAutoApprove}
      prompt={prompt}
      toolName={toolName}
      artifactUrl={artifactUrl}
      onOpenArtifact={onOpenArtifact}
      renderArtifact={renderArtifact}
      submitArtifact={submitArtifact}
    />
  );
  // A pack turn that delegated nothing reads like any other turn (`--delegate` makes every turn one).
  const packShown = !!turn.pack && (turn.pack.tasks.length > 0 || pending.some((request) => request.subtaskId));
  const transcript =
    packShown && pending.length
      ? {
          ...turn,
          entries: turn.entries.filter(
            (item) =>
              item.kind !== 'approval' || item.decision || !pending.some((request) => request.id === item.request.id),
          ),
        }
      : turn;
  return (
    <section className="gc-turn">
      {shown === null || shown === undefined || shown === false || (shown === '' && turn.attachments?.length) ? null : (
        <div className="gc-prompt">{shown}</div>
      )}
      <TurnAttachments items={turn.attachments} />
      {transcript.entries.length ? (
        <div className="gc-agent-row">
          <div className="gc-avatar" title={speaker} aria-hidden="true">
            {speaker.slice(0, 2)}
          </div>
          <div className="gc-steps">
            {fold ? (
              <Folded turn={transcript} pending={pending} toolName={toolName} entry={entry} />
            ) : (
              transcript.entries.map(entry)
            )}
          </div>
        </div>
      ) : null}
      {packShown ? (
        <PackTasks
          turn={turn}
          cwd={cwd}
          pending={pending}
          act={onPackAction}
          approval={(request) => entry({ kind: 'approval', request }, 0)}
        />
      ) : null}
      {running ? (
        <div className="gc-working">
          <span className="gc-spin" /> {speaker} is working
          {/* The ticking time stays out of the transcript's live region. */}
          <span aria-hidden="true">· {formatDuration(now - turn.startedAt)}</span>
        </div>
      ) : (
        <div className={`gc-turn-footer${bad ? ' gc-bad' : ''}`}>
          {turnFooter(turn, now)} · {speaker}
        </div>
      )}
    </section>
  );
}

/** `foldSteps`: the work in one closed line, then what the user has to see. */
function Folded({
  turn,
  pending,
  toolName,
  entry,
}: {
  turn: SessionTurn;
  pending: SessionState['approvals'];
  toolName: (name: string) => string;
  entry: (item: SessionEntry, i: number) => ReactNode;
}) {
  const { entries } = turn;
  // The last text is the answer once the turn ends, or while it is still the newest entry.
  const lastText = entries.map((item) => item.kind).lastIndexOf('text');
  const answer = lastText >= 0 && (turn.result || lastText === entries.length - 1) ? lastText : -1;
  const inView = (item: SessionEntry, i: number) =>
    i === answer ||
    item.kind === 'error' ||
    item.kind === 'failover' ||
    item.kind === 'artifact' ||
    item.kind === 'input' ||
    (item.kind === 'approval' && !item.decision && pending.some((request) => request.id === item.request.id));
  const steps = entries.map((item, i) => [item, i] as const).filter(([item, i]) => !inView(item, i));
  const tools = steps.filter(([item]) => item.kind === 'tool').length;
  const failed = steps.some(([item]) => item.kind === 'tool' && item.isError);
  // The newest tool still open; an edit's `files` entry can arrive before the tool ends.
  const open = turn.result ? undefined : entries.findLast((item) => item.kind === 'tool' && !item.done);
  const now = open?.kind === 'tool' ? toolName(open.name) : undefined;
  const count = tools || steps.length;
  return (
    <>
      {steps.length ? (
        <details className="gc-fold">
          <summary>
            {turn.result ? null : <span className="gc-spin" />}
            {count} {count === 1 ? 'step' : 'steps'}
            {now ? <span className="gc-fold-now"> · {now}</span> : null}
            {failed ? <span className="gc-err"> · errors</span> : null}
          </summary>
          <div className="gc-fold-body">{steps.map(([item, i]) => entry(item, i))}</div>
        </details>
      ) : null}
      {entries.map((item, i) => (inView(item, i) ? entry(item, i) : null))}
    </>
  );
}

function Entry({
  entry,
  agent,
  cwd,
  pending,
  onApprove,
  onAutoApprove,
  prompt,
  toolName,
  artifactUrl,
  onOpenArtifact,
  renderArtifact,
  submitArtifact,
}: {
  artifactUrl?: AgentChatProps['artifactUrl'];
  onOpenArtifact?: AgentChatProps['onOpenArtifact'];
  renderArtifact?: AgentChatProps['renderArtifact'];
  submitArtifact?: SubmitArtifact;
  entry: SessionEntry;
  agent: string;
  cwd: string;
  pending: SessionState['approvals'];
  onApprove?: AgentChatProps['onApprove'];
  onAutoApprove?: AgentChatProps['onAutoApprove'];
  prompt?: AgentChatProps['renderPrompt'];
  toolName: (name: string) => string;
}) {
  const openFile = useContext(OpenFile);
  const onAnswer = useContext(AnswerQuestion);
  const mdConfig = useContext(MarkdownConfig);
  switch (entry.kind) {
    case 'text':
      return (
        <Markdown
          text={entry.text}
          streaming={entry.streaming}
          imageUrl={mdConfig.imageUrl}
          remoteImages={mdConfig.remoteImages}
        />
      );
    case 'tool': {
      const argument = toolArgument(entry.input, cwd);
      const diff = toolDiff(entry.input);
      const file = openFile ? toolPath(entry.input) : undefined;
      const output = entry.output?.trim();
      return (
        <details className="gc-tool">
          <summary title={argument || undefined}>
            <span className={`gc-state${entry.done ? (entry.isError ? ' gc-err' : ' gc-ok') : ''}`}>
              {entry.done ? entry.isError ? '✗' : '✓' : <span className="gc-spin" />}
            </span>
            <span className="gc-tool-name">{toolName(entry.name)}</span>
            <span className="gc-tool-arg">{argument}</span>
            {diff ? <DiffStat diff={diff} /> : null}
          </summary>
          {file ? (
            <button
              type="button"
              className="gc-open-file"
              data-gc-file={file}
              onClick={(event) => {
                event.stopPropagation();
                openFile?.(file);
              }}
            >
              Open {relativePath(file, cwd)}
            </button>
          ) : null}
          {diff ? <DiffLines diff={diff} /> : null}
          {/* An edit that went through says nothing worth a box of its own. */}
          {diff && entry.done && !entry.isError && !output ? null : (
            <pre>{output || (entry.done ? 'No output.' : 'Running…')}</pre>
          )}
        </details>
      );
    }
    case 'files': {
      const paths = (
        <div className="gc-files">
          <span>✎ Edited</span>
          {entry.paths.map((path) =>
            openFile ? (
              <button
                key={path}
                type="button"
                className="gc-open-file"
                data-gc-file={path}
                onClick={(event) => {
                  event.stopPropagation();
                  openFile(path);
                }}
              >
                {relativePath(path, cwd)}
              </button>
            ) : (
              <code key={path}>{relativePath(path, cwd)}</code>
            ),
          )}
        </div>
      );
      // An agent that reports its edits as changed files, not as tool calls, says what changed here.
      const diff = entry.diff ? toolDiff(entry.diff) : undefined;
      if (!diff) return paths;
      return (
        <details className="gc-tool gc-edited">
          <summary>
            <span className="gc-state gc-ok">✓</span>
            <span className="gc-tool-name">Edited</span>
            <span className="gc-tool-arg">{entry.paths.map((path) => relativePath(path, cwd)).join(' ')}</span>
            <DiffStat diff={diff} />
          </summary>
          {openFile ? paths : null}
          <DiffLines diff={diff} />
        </details>
      );
    }
    case 'artifact': {
      const url = artifactUrl?.(entry.artifact);
      const custom = renderArtifact?.(entry.artifact, url);
      return custom !== undefined ? (
        custom
      ) : (
        <ArtifactCard artifact={entry.artifact} url={url} onOpen={onOpenArtifact} onSubmit={submitArtifact} />
      );
    }
    case 'approval': {
      const what =
        entry.request.kind === 'command' ? 'run' : entry.request.kind === 'file-change' ? 'apply edits to' : 'do';
      const subject = entry.request.summary ?? entry.request.id;
      const waiting = pending.some((request) => request.id === entry.request.id);
      if (entry.request.kind === 'question' && entry.request.questions?.length) {
        if (!entry.decision && waiting)
          return <QuestionCard agent={agent} request={entry.request} onAnswer={onAnswer} onApprove={onApprove} />;
        const given = entry.decision === 'approve' ? answerSummary(entry.request, entry.answers) : '';
        return (
          <div className="gc-approval gc-done">
            {given ? '✓ Answered' : entry.decision ? '– Skipped' : '– Not answered'}:&nbsp;
            <span className="gc-what">{given || subject}</span>
          </div>
        );
      }
      if (entry.decision || !waiting) {
        // Not pending and no decision: the turn ended (or was stopped) before an answer.
        const label =
          entry.decision === 'approve'
            ? entry.automatic
              ? '✓ Auto-approved'
              : '✓ Approved'
            : entry.decision
              ? entry.automatic
                ? '✗ Denied by policy'
                : '✗ Denied'
              : '– Not answered';
        return (
          <div className="gc-approval gc-done">
            {label}: {what}&nbsp;
            <span className="gc-what">{subject}</span>
          </div>
        );
      }
      return (
        <div className="gc-approval">
          <div>
            <strong>{agent}</strong> wants to {what}:
          </div>
          <div className="gc-what">{subject}</div>
          {onApprove ? (
            <div className="gc-buttons">
              <button
                type="button"
                className="gc-btn gc-primary"
                onClick={() => onApprove(entry.request.id, 'approve')}
              >
                {entry.request.scope === 'turn' ? 'Approve for this turn' : 'Approve'}
              </button>
              {onAutoApprove ? (
                <button
                  type="button"
                  className="gc-btn"
                  title="Approve this and every future permission request in this session"
                  onClick={() => onAutoApprove()}
                >
                  Auto-approve all
                </button>
              ) : null}
              <button type="button" className="gc-btn gc-danger" onClick={() => onApprove(entry.request.id, 'deny')}>
                Deny
              </button>
            </div>
          ) : (
            <div className="gc-waiting">Waiting for approval…</div>
          )}
        </div>
      );
    }
    case 'input': {
      const shown = prompt ? prompt(entry.text) : entry.text;
      if (shown === null || shown === undefined || shown === false) return null;
      return (
        <div className="gc-prompt gc-steer">
          <small>Sent while working</small>
          {shown}
        </div>
      );
    }
    case 'error':
      return <div className="gc-error">{entry.message}</div>;
    case 'failover':
      return <div className="gc-failover">{describeFailover(entry.from, entry.to, entry.failure)}</div>;
  }
}

function DiffStat({ diff }: { diff: ToolDiff }) {
  return (
    <span className="gc-diff-stat" aria-label={`${diff.added} lines added, ${diff.removed} removed`}>
      {diff.added ? <ins>+{diff.added}</ins> : null}
      {diff.removed ? <del>−{diff.removed}</del> : null}
    </span>
  );
}

function DiffLines({ diff }: { diff: ToolDiff }) {
  return (
    <div className="gc-diff">
      {diff.lines.map((line, index) => (
        <div key={index} data-sign={line.sign}>
          {line.text || ' '}
        </div>
      ))}
      {diff.more ? <div className="gc-diff-more">… {diff.more} more lines</div> : null}
    </div>
  );
}

/**
 * The message that carries what the user sent from an artifact (`onArtifactSubmit`) to the
 * agent: it names the artifact and holds `data` as JSON.
 */
export function artifactSubmission(artifact: Pick<Artifact, 'title' | 'name'>, data: unknown): string {
  const json = JSON.stringify(data, null, 2) ?? 'null';
  // Longer than any run of backticks inside, so the data cannot close the block.
  const fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map((run) => run[0].length + 1)));
  return [
    `Submitted from the artifact "${artifact.title}" (name: ${artifact.name}). The user filled in the page you published and confirmed sending this data:`,
    '',
    `${fence}json`,
    json,
    fence,
  ].join('\n');
}

/**
 * An artifact the agent published. Agent-written content never joins this page: HTML and text
 * load in a sandboxed frame with an origin of their own, images, audio and video as plain media.
 * When `onOpen` is provided, clicking **Open** opens the artifact in the host's viewer panel
 * instead of expanding inline.
 */
function ArtifactCard({
  artifact,
  url,
  onOpen,
  onSubmit,
}: {
  artifact: Artifact;
  url: string | undefined;
  onOpen?: (artifact: Artifact) => void;
  onSubmit?: SubmitArtifact;
}) {
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const canPreview = !!url && canPreviewArtifact(artifact);
  const inlineOpen = !onOpen && open && !!url;
  const [asked, clearAsked] = useArtifactSubmit(
    frame,
    inlineOpen && !!onSubmit && artifact.kind === 'html',
    artifact.id,
    artifact.version,
  );
  const isPdf = artifact.mimeType === 'application/pdf';
  return (
    <div className="gc-artifact">
      <div className="gc-artifact-head">
        <span className="gc-artifact-icon" aria-hidden="true">
          ◆
        </span>
        <span className="gc-artifact-title" title={artifact.path ?? artifact.title}>
          {artifact.title}
        </span>
        <span className="gc-artifact-meta">
          {artifactKindLabel(artifact)} · {formatBytes(artifact.bytes)}
          {artifact.version > 1 ? ` · v${artifact.version}` : ''}
        </span>
        {canPreview ? (
          <button
            type="button"
            className="gc-btn"
            aria-expanded={onOpen ? undefined : open}
            onClick={() => (onOpen ? onOpen(artifact) : setOpen(!open))}
          >
            {!onOpen && open ? 'Hide' : 'Open'}
          </button>
        ) : null}
        {url ? (
          artifact.kind === 'file' && !isPdf ? (
            <a className="gc-btn" href={withDownloadParam(url)} download>
              Download
            </a>
          ) : (
            <a className="gc-btn" href={url} target="_blank" rel="noopener noreferrer">
              New tab
            </a>
          )
        ) : null}
      </div>
      {inlineOpen ? (
        artifact.kind === 'image' ? (
          <img className="gc-artifact-view" src={url} alt={artifact.title} />
        ) : artifact.kind === 'audio' ? (
          <audio className="gc-artifact-view" src={url} controls preload="metadata" />
        ) : artifact.kind === 'video' ? (
          <video className="gc-artifact-view" src={url} controls preload="metadata" playsInline />
        ) : isPdf ? (
          <iframe className="gc-artifact-view" title={artifact.title} src={url} referrerPolicy="no-referrer" />
        ) : (
          <iframe
            ref={frame}
            className="gc-artifact-view"
            title={artifact.title}
            src={url}
            // Scripts for pages only, and never `allow-same-origin`: the frame gets no cookies,
            // storage or DOM of this page, and cannot navigate it or open windows.
            sandbox={artifact.kind === 'html' ? 'allow-scripts' : ''}
            referrerPolicy="no-referrer"
          />
        )
      ) : null}
      {inlineOpen && asked && onSubmit ? (
        <ArtifactSubmitBar artifact={artifact} asked={asked} onSubmit={onSubmit} onDismiss={clearAsked} />
      ) : null}
    </div>
  );
}
