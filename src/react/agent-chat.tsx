import {
  createContext,
  type ComponentProps,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
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
import type { ProgressStep } from '../agents/progress.js';
import type { ApprovalDecision, Artifact, QuestionAnswers } from '../agents/types.js';
import { answerSummary, QuestionCard } from './question-card.js';
import { describeFailover } from '../agents/failover.js';
import { PendingAttachments, TurnAttachments, useAttachments, type ChatAttachments } from './attachments.js';
import { useEscape } from './escape.js';
import { useFollowScroll } from './follow-scroll.js';
import {
  clockTime,
  formatBytes,
  formatDuration,
  formatUsage,
  messageReceipt,
  limitChips,
  packWorkCount,
  packWorkLine,
  relativePath,
  shortId,
  SUBMIT,
  submitAction,
  submitTitle,
  toolArgument,
  toolDiff,
  toolLabel,
  toolPath,
  turnFooter,
  type ToolDiff,
} from './format.js';
import { Markdown, readFileLinkPosition, type FilePosition } from './markdown.js';
import { RevealRegistry, RevealTurn, useReveal, useRevealRegistry } from './reveal.js';
import { MissionStrip, type MissionStripProps } from './mission-strip.js';
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
   * Your id for the conversation `state` is of. What the inline task card remembers (its filter,
   * its cleared tasks, the task it shows) belongs to one conversation and turn: with another
   * `chatId` it starts afresh. Without it a conversation is told apart by when its first turn started.
   */
  chatId?: string;
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
   * The host shows delegated tasks in a `<WorkPanel>`: a turn's task card becomes one line
   * ("3 delegated tasks · 1 running · Open") that calls this with the turn. Approvals of tasks stay
   * in the transcript. Without it the card is inline, with its list and actions, as before.
   */
  onOpenTasks?(turn: SessionTurn): void;
  /**
   * Shows the mission strip (`<MissionStrip>`) above the message box while delegated work runs: the
   * tasks counted by state, what the lead does now, and the next approval a task waits for, with
   * Approve and Deny (`onApprove`). With its `onOpenGroup` and `onOpenTasks`, an approval of a
   * delegated task is answered on the strip (and in the host's `<WorkPanel>`) and no longer shows in
   * the transcript; the lead's own approvals and every question stay inline. Pass `{}` for a strip
   * that opens nothing; the transcript then keeps every approval, since the strip shows only the first.
   */
  missionStrip?: Pick<MissionStripProps, 'onOpenGroup' | 'onOpenTask' | 'pullRequests' | 'dismissed'>;
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
  /**
   * Replaces the error display of a failed turn (e.g. a sign-in card when `failure.kind === 'auth'`).
   * Return undefined/null/false to keep the default error entries and footer.
   */
  renderFailure?(turn: SessionTurn): ReactNode;
  /** Host content at the end of the transcript, after the last turn. */
  renderFooter?(): ReactNode;
  /** Host lines between turns. */
  notices?: readonly ChatNotice[];
  /**
   * Collapse tools, edits and earlier updates. Keep the latest status and plan visible during work,
   * along with the answer, errors, steering input and open approvals. Default false.
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
  /**
   * `'card'` draws the composer as one card: the message field on top and one row under it with
   * the attach buttons, `composerExtras`, Stop and the submit button (with its Enter key hint).
   * Default: the field with Stop and submit beside it, and `composerExtras` in a row below.
   */
  composerLayout?: 'card';
  /**
   * A line above the message field, e.g. where a new chat starts. In the card layout it is the
   * card's first line.
   */
  composerHeader?: ReactNode;
  /** Line under the composer. Default: the keys. Pass null for none. */
  hint?: ReactNode;
  /** A tooltip on the message box, e.g. its keys when `hint` is `null`. */
  composerTitle?: string;
  /** Keep the user from sending (the box stays editable), e.g. while the host is disconnected. */
  disabled?: boolean;
  /**
   * While `disabled`, a message this accepts is sent all the same (without files), e.g. the host's
   * commands that move it to another chat while it waits for one.
   */
  sendsWhileDisabled?(draft: string): boolean;
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
  // Context values stay the same object across renders, so entries kept closed are not re-rendered
  // by a host that passes new callbacks each time.
  const markdownConfig = useMemo(
    () => ({ imageUrl: props.imageUrl, remoteImages: props.remoteImages }),
    [props.imageUrl, props.remoteImages],
  );
  const answerQuestion = useLatest(props.onAnswer);
  const openFile = useLatest(props.onOpenFile);
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
    window.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [fileMenu]);
  useEscape(!!fileMenu, () => setFileMenu(undefined));

  const attached = useAttachments(props.attachments);
  const picker = useRef<HTMLInputElement>(null);
  const sendable =
    (!!draft.trim() || attached.files.length > 0) &&
    (!props.disabled || (!attached.files.length && !!props.sendsWhileDisabled?.(draft))) &&
    !attached.recording;
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
  const card = props.composerLayout === 'card';
  const header = props.composerHeader;
  const hasHeader = header !== undefined && header !== null && header !== false;
  // What Enter does now: the submit button says it, and Stop is a button of its own beside it.
  const action = submitAction(state);
  const submitHover = sendable
    ? submitTitle(state)
    : props.disabled
      ? undefined
      : attached.enabled
        ? 'Type a message or attach a file'
        : 'Type a message';
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
  // Turn ids start again in each conversation: what a turn remembers is kept per conversation.
  const firstTurn = state.turns[0]?.startedAt;
  const chatId = props.chatId || undefined;
  const previousChat = useRef<{ id?: string; firstTurn?: number; key: string }>(undefined);
  const previous = previousChat.current;
  const sameChat =
    previous &&
    (chatId
      ? previous.id === chatId || (!previous.id && previous.firstTurn === firstTurn)
      : !previous.id && previous.firstTurn === firstTurn);
  const conversation = sameChat ? previous.key : chatId ? `chat:${chatId}` : `first:${firstTurn ?? ''}`;
  useLayoutEffect(() => {
    previousChat.current = { id: chatId, firstTurn, key: conversation };
  }, [chatId, firstTurn, conversation]);
  const revealSeen = useRevealRegistry(state.turns, (turn) => `${conversation}:${turn.id}`);
  state.turns.forEach((turn, index) => {
    flush(index);
    items.push(
      <RevealTurn.Provider key={`${conversation}:${turn.id}`} value={`${conversation}:${turn.id}`}>
        <Turn
          turn={turn}
          now={now}
          cwd={state.cwd}
          pending={turn.result ? [] : state.approvals}
          onApprove={props.onApprove}
          onAutoApprove={props.onAutoApprove}
          onPackAction={props.disabled ? undefined : props.onPackAction}
          onOpenTasks={props.onOpenTasks}
          taskApprovalsElsewhere={!!props.missionStrip?.onOpenGroup && !!props.onOpenTasks}
          prompt={props.renderPrompt}
          toolName={props.formatToolName ?? toolLabel}
          artifactUrl={props.artifactUrl}
          onOpenArtifact={props.onOpenArtifact}
          renderArtifact={props.renderArtifact}
          renderFailure={props.renderFailure}
          submitArtifact={submitArtifact}
          fold={props.foldSteps ?? false}
        />
      </RevealTurn.Provider>,
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

  const pendingFiles = (
    <>
      {attached.enabled ? <PendingAttachments files={attached.files} onRemove={attached.remove} /> : null}
      {attached.problem ? (
        <div className="gc-attach-problem" role="alert">
          {attached.problem}
        </div>
      ) : null}
    </>
  );
  const field = (
    <textarea
      ref={input}
      rows={card ? 2 : 1}
      autoFocus={props.autoFocus}
      value={draft}
      placeholder={placeholder}
      title={props.composerTitle}
      aria-label="Message"
      aria-disabled={props.disabled || undefined}
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
  );
  // Stop never takes the place of the submit button: while the agent works both are there.
  const stopButton =
    (running || props.canStop) && props.onStop ? (
      <button
        type="button"
        className="gc-btn gc-danger gc-stop"
        title="Stop the turn. Queued prompts are dropped."
        onClick={() => props.onStop?.()}
      >
        {card ? (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
          </svg>
        ) : null}
        Stop
      </button>
    ) : null;
  const submitButton = (
    <button
      type="button"
      className="gc-btn gc-primary gc-submit"
      data-action={action}
      title={submitHover}
      disabled={!sendable}
      onClick={send}
    >
      {SUBMIT[action].label}
      {card ? <kbd aria-hidden="true">↵</kbd> : null}
    </button>
  );

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
    <RevealRegistry.Provider value={revealSeen}>
      <MarkdownConfig.Provider value={markdownConfig}>
        <AnswerQuestion.Provider value={answerQuestion}>
          <OpenFile.Provider value={openFile}>
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
                  {state.mode === 'plan' ? <span className="gc-chip">plan</span> : null}
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
              <div className={card ? 'gc-composer gc-composer-card' : 'gc-composer'}>
                {props.missionStrip ? (
                  <MissionStrip
                    state={state}
                    {...props.missionStrip}
                    onApprove={props.onApprove}
                    disabled={props.disabled}
                  />
                ) : null}
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
                {hasHeader && !card ? <div className="gc-composer-header">{header}</div> : null}
                {card ? null : pendingFiles}
                {card ? (
                  <div className="gc-card" data-disabled={props.disabled ? '1' : undefined}>
                    {hasHeader ? <div className="gc-composer-header">{header}</div> : null}
                    {pendingFiles}
                    {field}
                    <div className="gc-card-row">
                      {attachButtons}
                      {hasExtras ? extras : <span className="gc-grow" />}
                      {stopButton}
                      {submitButton}
                    </div>
                  </div>
                ) : (
                  <div
                    className={stacked ? 'gc-box gc-stacked' : 'gc-box'}
                    data-disabled={props.disabled ? '1' : undefined}
                  >
                    {field}
                    {hasExtras ? null : attachButtons}
                    {stacked ? <span className="gc-grow" /> : null}
                    {stopButton}
                    {submitButton}
                  </div>
                )}
                {hasExtras && !card ? (
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
    </RevealRegistry.Provider>
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

/** A layout effect in the browser; a plain one (which the server skips quietly) when rendering on a server. */
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** A function that stays the same while `fn` is given, and always calls the latest `fn`. */
function useLatest<A extends unknown[], R>(fn: ((...args: A) => R) | undefined): ((...args: A) => R) | undefined {
  const latest = useRef(fn);
  // After commit: a render React may still throw away must not swap the handler a click reaches.
  useClientLayoutEffect(() => {
    latest.current = fn;
  });
  const given = fn !== undefined;
  return useMemo(() => (given ? callLatest(latest) : undefined), [given]);
}

/** Built outside the hook, so the wrapper holds the ref and nothing else of the render that made it. */
function callLatest<A extends unknown[], R>(latest: { current: ((...args: A) => R) | undefined }) {
  return (...args: A) => latest.current?.(...args) as R;
}

const NO_APPROVALS: SessionState['approvals'] = [];

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
  onOpenTasks,
  taskApprovalsElsewhere,
  prompt,
  toolName,
  artifactUrl,
  onOpenArtifact,
  renderArtifact,
  renderFailure,
  submitArtifact,
  fold,
}: {
  artifactUrl?: AgentChatProps['artifactUrl'];
  onOpenArtifact?: AgentChatProps['onOpenArtifact'];
  renderArtifact?: AgentChatProps['renderArtifact'];
  renderFailure?: AgentChatProps['renderFailure'];
  submitArtifact?: SubmitArtifact;
  turn: SessionTurn;
  now: number;
  cwd: string;
  pending: SessionState['approvals'];
  onApprove?: AgentChatProps['onApprove'];
  onAutoApprove?: AgentChatProps['onAutoApprove'];
  onPackAction?: PackActionHandler;
  onOpenTasks?: AgentChatProps['onOpenTasks'];
  /** The mission strip has the approvals of delegated tasks: they are not repeated here. */
  taskApprovalsElsewhere?: boolean;
  prompt?: AgentChatProps['renderPrompt'];
  toolName: (name: string) => string;
  fold: boolean;
}) {
  const running = !turn.result;
  const speaker = turn.pack?.lead ?? turn.agent;
  const bad = turn.result && !turn.result.ok;
  const customFailure = bad ? renderFailure?.(turn) : undefined;
  const hasCustomFailure = customFailure !== undefined && customFailure !== null && customFailure !== false;
  const shown = prompt ? prompt(turn.prompt, turn) : turn.prompt;
  const entryProps = (item: SessionEntry): EntryProps => {
    // Only an approval still waiting can be answered: one decided or left behind holds no callbacks.
    const live =
      item.kind === 'approval' && !item.decision && pending.some((request) => request.id === item.request.id);
    return {
      entry: item,
      agent:
        item.kind === 'approval' && turn.pack
          ? (turn.pack.tasks.find((task) => task.id === item.request.subtaskId)?.agent ?? turn.pack.lead)
          : (turn.pack?.lead ?? turn.agent),
      cwd,
      // Each kind gets only what it uses: a closed step keeps its element, and a host callback it held
      // would keep that render's whole view alive.
      pending: live ? pending : NO_APPROVALS,
      onApprove: live ? onApprove : undefined,
      onAutoApprove: live ? onAutoApprove : undefined,
      prompt: item.kind === 'input' ? prompt : undefined,
      // Answered: the agent began a message after it took this one (the session records when).
      answered: item.kind === 'input' && item.delivery === 'delivered' && item.answeredAt !== undefined,
      toolLabel: item.kind === 'tool' ? toolName(item.name) : undefined,
      artifactUrl: item.kind === 'artifact' ? artifactUrl : undefined,
      onOpenArtifact: item.kind === 'artifact' ? onOpenArtifact : undefined,
      renderArtifact: item.kind === 'artifact' ? renderArtifact : undefined,
      submitArtifact: item.kind === 'artifact' ? submitArtifact : undefined,
    };
  };
  const entry = (item: SessionEntry, i: number) => <Entry key={i} {...entryProps(item)} />;
  // A pack turn that delegated nothing reads like any other turn (`--delegate` makes every turn one).
  const visiblePackTasks = turn.pack ? turn.pack.tasks.filter((task) => !task.dismissed) : [];
  const packShown = !!turn.pack && (visiblePackTasks.length > 0 || pending.some((request) => request.subtaskId));
  const filteredEntries = turn.entries.filter((item) => {
    if (hasCustomFailure && item.kind === 'error') return false;
    // With the tasks in the host's panel, their approvals stay here in the transcript.
    if (
      packShown &&
      !onOpenTasks &&
      pending.length &&
      item.kind === 'approval' &&
      !item.decision &&
      pending.some((request) => request.id === item.request.id)
    )
      return false;
    // On the mission strip instead. A question stays: its options are answered here.
    if (
      taskApprovalsElsewhere &&
      item.kind === 'approval' &&
      !item.decision &&
      item.request.subtaskId &&
      item.request.kind !== 'question' &&
      pending.some((request) => request.id === item.request.id)
    )
      return false;
    return true;
  });
  const transcript = filteredEntries.length === turn.entries.length ? turn : { ...turn, entries: filteredEntries };
  return (
    <section className="gc-turn">
      {shown === null || shown === undefined || shown === false || (shown === '' && turn.attachments?.length) ? null : (
        <div className="gc-prompt">{shown}</div>
      )}
      <TurnAttachments items={turn.attachments} />
      {transcript.entries.length || hasCustomFailure ? (
        <div className="gc-agent-row">
          <div className="gc-avatar" title={speaker} aria-hidden="true">
            {speaker.slice(0, 2)}
          </div>
          <div className="gc-steps">
            {transcript.entries.length ? (
              fold ? (
                <Folded turn={transcript} pending={pending} toolName={toolName} entry={entry} entryProps={entryProps} />
              ) : (
                transcript.entries.map(entry)
              )
            ) : null}
            {hasCustomFailure ? customFailure : null}
          </div>
        </div>
      ) : null}
      {packShown && onOpenTasks ? (
        <button type="button" className="gc-workline" onClick={() => onOpenTasks(turn)}>
          <b>{packWorkCount(visiblePackTasks.length)}</b>
          <span>{packWorkLine(visiblePackTasks, pending)}</span>
          <span className="gc-workline-open">Open ›</span>
        </button>
      ) : packShown ? (
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
          {hasCustomFailure
            ? turn.result?.failure?.kind === 'auth'
              ? 'sign-in required'
              : 'failed'
            : turnFooter(turn, now)}{' '}
          · {speaker}
        </div>
      )}
    </section>
  );
}

/** The work in one closed line, then, oldest first, what the user has to see: the latest reply and status, plan, inputs, errors. */
function Folded({
  turn,
  pending,
  toolName,
  entry,
  entryProps,
}: {
  turn: SessionTurn;
  pending: SessionState['approvals'];
  toolName: (name: string) => string;
  entry: (item: SessionEntry, i: number) => ReactNode;
  entryProps: (item: SessionEntry) => EntryProps;
}) {
  const { entries } = turn;
  const lastText = entries.findLastIndex((item) => item.kind === 'text');
  const answer = turn.result ? lastText : -1;
  // The latest status stays in view beside the latest reply, also when the reply comes after it.
  const update = turn.result ? -1 : entries.findLastIndex((item) => item.kind === 'progress');
  const plan = turn.result
    ? undefined
    : entries.findLast((item) => item.kind === 'progress' && item.plan !== undefined);
  const inView = (item: SessionEntry, i: number) =>
    i === answer ||
    // The latest reply stays out of the steps while the turn runs, also when a progress report lands
    // after it: it keeps its place in this list, and its state, until it ends as the answer.
    i === lastText ||
    item.kind === 'error' ||
    item.kind === 'failover' ||
    item.kind === 'artifact' ||
    item.kind === 'input' ||
    (item.kind === 'approval' && !item.decision && pending.some((request) => request.id === item.request.id));
  const steps = entries.map((item, i) => [item, i] as const).filter(([item, i]) => i !== update && !inView(item, i));
  const tools = steps.filter(([item]) => item.kind === 'tool').length;
  const failed = steps.some(([item]) => item.kind === 'tool' && item.isError);
  // The newest tool still open; an edit's `files` entry can arrive before the tool ends.
  const open = turn.result ? undefined : entries.findLast((item) => item.kind === 'tool' && !item.done);
  const now = open?.kind === 'tool' ? toolName(open.name) : undefined;
  const count = tools || steps.length;
  // One keyed list in a fixed order, the steps first and then what is in view, oldest first: the
  // end of the turn moves nothing (a moved artifact frame would reload and lose what was typed in it),
  // and the latest reply keeps its element and state when it becomes the answer.
  const fold = steps.length ? (
    <LazyDetails
      key="fold"
      className="gc-fold"
      summary={
        <summary>
          {turn.result ? null : <span className="gc-spin" />}
          {count} {count === 1 ? 'step' : 'steps'}
          {now ? <span className="gc-fold-now"> · {now}</span> : null}
          {failed ? <span className="gc-err"> · errors</span> : null}
        </summary>
      }
      data={() => steps.map(([item, i]) => [i, entryProps(item)] as const)}
      Body={FoldBody}
    />
  ) : null;
  const planShown = plan?.kind === 'progress' && plan !== entries[update];
  return (
    <>
      {[
        fold,
        ...entries.flatMap((item, i) =>
          i === update
            ? [entry(item, i), planShown ? <ProgressPlan key="plan" steps={plan.plan} /> : null]
            : inView(item, i)
              ? [entry(item, i)]
              : [],
        ),
      ]}
    </>
  );
}

function ProgressPlan({ steps }: { steps?: ProgressStep[] }) {
  if (!steps?.length) return null;
  return (
    <ol className="gc-progress-plan" aria-label="Plan">
      {steps.map(({ step, status }, i) => (
        <li key={i} aria-current={status === 'in_progress' ? 'step' : undefined}>
          {step} <span className="gc-progress-state">{status.replace('_', ' ')}</span>
        </li>
      ))}
    </ol>
  );
}

/** A reply's text, revealed quickly when it arrived whole (`useReveal`). */
function RevealedMarkdown(props: {
  text: string;
  streaming?: boolean;
  imageUrl?: (path: string) => string | undefined;
  remoteImages?: 'click' | 'load';
}) {
  const shown = useReveal(props.text, props.streaming);
  return (
    <Markdown
      text={shown}
      streaming={props.streaming || shown !== props.text}
      imageUrl={props.imageUrl}
      remoteImages={props.remoteImages}
    />
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
  answered,
  toolLabel,
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
  /** An input entry the agent answered: it said something after taking it. */
  answered?: boolean;
  /** A tool's display name, worked out by the turn: a kept step must not hold the formatter. */
  toolLabel?: string;
}) {
  const openFile = useContext(OpenFile);
  const onAnswer = useContext(AnswerQuestion);
  const mdConfig = useContext(MarkdownConfig);
  switch (entry.kind) {
    case 'progress':
      return (
        <div className="gc-progress">
          <div>{entry.message}</div>
          <ProgressPlan steps={entry.plan} />
        </div>
      );
    case 'text':
      return (
        <RevealedMarkdown
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
        <LazyDetails
          className="gc-tool"
          summary={
            <summary title={argument || undefined}>
              <span className={`gc-state${entry.done ? (entry.isError ? ' gc-err' : ' gc-ok') : ''}`}>
                {entry.done ? entry.isError ? '✗' : '✓' : <span className="gc-spin" />}
              </span>
              <span className="gc-tool-name">{toolLabel}</span>
              <span className="gc-tool-arg">{argument}</span>
              {diff ? <DiffStat diff={diff} /> : null}
            </summary>
          }
          data={() => ({ file, cwd, diff, output, done: entry.done, isError: entry.isError })}
          Body={ToolBody}
        />
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
      const receipt = messageReceipt(entry, agent, { answered });
      return (
        <div className="gc-prompt gc-steer" data-delivery={entry.delivery}>
          <small
            role="status"
            data-receipt={receipt.state}
            title={receipt.title}
            aria-label={`Your message: ${receipt.spoken}`}
          >
            {receipt.text}
            {entry.at !== undefined ? (
              <time dateTime={new Date(entry.at).toISOString()}>{clockTime(entry.at)}</time>
            ) : null}
          </small>
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

/**
 * A `<details>` that builds what it hides only once opened, then keeps it (and the state inside,
 * such as tools opened within a fold) when closed again. A long conversation folds hundreds of
 * steps; rendering their output while closed made every update and keystroke slow.
 */
function LazyDetails<T>({
  summary,
  data,
  Body,
  ...rest
}: Omit<ComponentProps<'details'>, 'children' | 'onToggle'> & {
  summary: ReactNode;
  /** Plain data for `Body`, read when the step opens. */
  data: () => T;
  /** A module-level component: elements made here, not in a render's closures, hold nothing of that render. */
  Body: (props: { data: T }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  // Opened before React took over the page (server rendering): build the body now.
  useClientLayoutEffect(() => {
    if (details.current?.open) setOpen(true);
  }, []);
  // While closed, the body last committed, the same element: React skips the subtree until it opens.
  const kept = useRef<ReactNode>(null);
  const body = open ? <Body data={data()} /> : kept.current;
  useClientLayoutEffect(() => {
    kept.current = body;
  });
  return (
    <details {...rest} ref={details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      {summary}
      {body}
    </details>
  );
}

type EntryProps = Parameters<typeof Entry>[0];

function FoldBody({ data }: { data: (readonly [number, EntryProps])[] }) {
  return (
    <div className="gc-fold-body">
      {data.map(([i, props]) => (
        <Entry key={i} {...props} />
      ))}
    </div>
  );
}

function ToolBody({
  data: { file, cwd, diff, output, done, isError },
}: {
  data: { file?: string; cwd: string; diff?: ToolDiff; output?: string; done: boolean; isError?: boolean };
}) {
  const openFile = useContext(OpenFile);
  return (
    <>
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
      {diff && done && !isError && !output ? null : <pre>{output || (done ? 'No output.' : 'Running…')}</pre>}
    </>
  );
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
