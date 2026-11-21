import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { SessionEntry, SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalDecision, Artifact } from '../agents/types.js';
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
  turnFooter,
} from './format.js';
import { Markdown } from './markdown.js';
import { PackTasks, type PackActionHandler } from './pack-tasks.js';

/** A line from the host itself (not the agent), shown between turns. */
export interface ChatNotice {
  /** Stable key. */
  id: string | number;
  /** Shown after this many turns: 0 before the first turn, `state.turns.length` at the end. */
  afterTurn: number;
  text: ReactNode;
  tone?: 'info' | 'error';
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
  /** Tool name as shown, e.g. without an MCP server prefix. Default: friendlier names for common tools. */
  formatToolName?(name: string): string;
  /**
   * Where the host serves an artifact's content (`store.read()` with `artifactResponse()`, whose
   * headers keep agent-written HTML away from this page). Without it artifacts show as a card
   * with no preview. Put `artifact.version` in the URL so a new version reloads.
   */
  artifactUrl?(artifact: Artifact): string | undefined;
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
   * Host controls inside the composer, in the row under the text, before Send: what the next
   * prompt runs with (agent, model, mode). With them the text takes a row of its own.
   */
  composerExtras?: ReactNode;
  /** Line under the composer. Default: the keys. Pass null for none. */
  hint?: ReactNode;
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
export function AgentChat(props: AgentChatProps) {
  const state = props.state ?? NO_SESSION;
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const running = state?.status === 'running';
  const now = useNow(running);

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
  const rootClass = ['gc-chat', props.className].filter(Boolean).join(' ');
  const theme = props.theme && props.theme !== 'auto' ? props.theme : undefined;
  const agentName = state.agent || 'the agent';

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
  const stacked = attached.enabled || hasExtras;
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
  const notices = [...(props.notices ?? [])].sort((a, b) => a.afterTurn - b.afterTurn);
  const flush = (upTo: number) => {
    while (notices.length && notices[0].afterTurn <= upTo) {
      const notice = notices.shift()!;
      items.push(
        <div key={`n${notice.id}`} className={`gc-notice${notice.tone === 'error' ? ' gc-err' : ''}`}>
          {notice.text}
        </div>,
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

  return (
    <div
      className={rootClass}
      data-theme={theme}
      data-status={state.status}
      style={props.style}
      onDrop={onDrop}
      onDragOver={onDragOver}
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
              return shown === null || shown === undefined || shown === false ? null : <span key={i}>⏸ {shown}</span>;
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
          {attached.enabled ? (
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
          ) : null}
          {stacked ? <span className="gc-grow" /> : null}
          {hasExtras ? extras : null}
          {(running || props.canStop) && props.onStop ? (
            <button type="button" className="gc-btn gc-danger" onClick={() => props.onStop?.()}>
              Stop
            </button>
          ) : null}
          <button type="button" className="gc-btn gc-primary" disabled={!sendable} onClick={send}>
            {running ? (state.canSteer ? 'Steer' : 'Queue') : 'Send'}
          </button>
        </div>
        {props.hint === null ? null : (
          <div className="gc-hint">
            {props.hint ?? `Enter to send · Shift+Enter for a new line${props.onStop ? ' · Esc stops' : ''}`}
          </div>
        )}
      </div>
    </div>
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
  renderArtifact,
  submitArtifact,
  fold,
}: {
  artifactUrl?: AgentChatProps['artifactUrl'];
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
      renderArtifact={renderArtifact}
      submitArtifact={submitArtifact}
    />
  );
  const transcript =
    turn.pack && pending.length
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
      {turn.pack ? (
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
  renderArtifact,
  submitArtifact,
}: {
  artifactUrl?: AgentChatProps['artifactUrl'];
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
  switch (entry.kind) {
    case 'text':
      return <Markdown text={entry.text} streaming={entry.streaming} />;
    case 'tool': {
      const argument = toolArgument(entry.input, cwd);
      const diff = toolDiff(entry.input);
      const output = entry.output?.trim();
      return (
        <details className="gc-tool">
          <summary title={argument || undefined}>
            <span className={`gc-state${entry.done ? (entry.isError ? ' gc-err' : ' gc-ok') : ''}`}>
              {entry.done ? entry.isError ? '✗' : '✓' : <span className="gc-spin" />}
            </span>
            <span className="gc-tool-name">{toolName(entry.name)}</span>
            <span className="gc-tool-arg">{argument}</span>
            {diff ? (
              <span className="gc-diff-stat" aria-label={`${diff.added} lines added, ${diff.removed} removed`}>
                {diff.added ? <ins>+{diff.added}</ins> : null}
                {diff.removed ? <del>−{diff.removed}</del> : null}
              </span>
            ) : null}
          </summary>
          {diff ? (
            <div className="gc-diff">
              {diff.lines.map((line, index) => (
                <div key={index} data-sign={line.sign}>
                  {line.text || ' '}
                </div>
              ))}
              {diff.more ? <div className="gc-diff-more">… {diff.more} more lines</div> : null}
            </div>
          ) : null}
          {/* An edit that went through says nothing worth a box of its own. */}
          {diff && entry.done && !entry.isError && !output ? null : (
            <pre>{output || (entry.done ? 'No output.' : 'Running…')}</pre>
          )}
        </details>
      );
    }
    case 'files':
      return (
        <div className="gc-files">
          <span>✎ Edited</span>
          {entry.paths.map((path) => (
            <code key={path}>{relativePath(path, cwd)}</code>
          ))}
        </div>
      );
    case 'artifact': {
      const url = artifactUrl?.(entry.artifact);
      const custom = renderArtifact?.(entry.artifact, url);
      return custom !== undefined ? (
        custom
      ) : (
        <ArtifactCard artifact={entry.artifact} url={url} onSubmit={submitArtifact} />
      );
    }
    case 'approval': {
      const what =
        entry.request.kind === 'command' ? 'run' : entry.request.kind === 'file-change' ? 'apply edits to' : 'do';
      const subject = entry.request.summary ?? entry.request.id;
      const waiting = pending.some((request) => request.id === entry.request.id);
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

const ARTIFACT_KIND: Record<Artifact['kind'], string> = {
  html: 'Page',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  text: 'Document',
  file: 'File',
};

type SubmitArtifact = (artifact: Artifact, data: unknown) => void;

// Larger than any form needs; a page cannot flood the conversation.
const SUBMIT_MAX = 20_000;

/** What a page's `postMessage` asks to send, as JSON text; undefined when it is not a submit. */
function submitted(message: unknown): { data: unknown; json: string } | { tooLarge: true } | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  if ((message as { genaicode?: unknown }).genaicode !== 'submit') return undefined;
  const data = (message as { data?: unknown }).data;
  let json: string | undefined;
  try {
    json = JSON.stringify(data, null, 2);
  } catch {
    return undefined;
  }
  if (json === undefined) return undefined;
  return json.length > SUBMIT_MAX ? { tooLarge: true } : { data: JSON.parse(json) as unknown, json };
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
 * The one thing a page can do to this one is ask (`postMessage`) to send data to the agent,
 * and that waits for the user to confirm what is sent.
 */
function ArtifactCard({
  artifact,
  url,
  onSubmit,
}: {
  artifact: Artifact;
  url: string | undefined;
  onSubmit?: SubmitArtifact;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<ReturnType<typeof submitted>>();
  const frame = useRef<HTMLIFrameElement>(null);
  const canPreview = !!url && artifact.kind !== 'file';
  const listening = open && !!onSubmit && artifact.kind === 'html';
  useEffect(() => {
    if (!listening) return;
    const listen = (event: MessageEvent) => {
      // Only the frame of this card, whatever origin it claims.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const next = submitted(event.data);
      if (next) setAsked(next);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [listening]);
  const confirm = useRef<HTMLDivElement>(null);
  // The confirmation sits under the page, often below the fold.
  useEffect(() => {
    if (asked) confirm.current?.scrollIntoView?.({ block: 'nearest' });
  }, [asked]);
  // What a page asked belongs to that version, and to the frame while it is open.
  useEffect(() => setAsked(undefined), [open, artifact.id, artifact.version]);
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
          {ARTIFACT_KIND[artifact.kind]} · {formatBytes(artifact.bytes)}
          {artifact.version > 1 ? ` · v${artifact.version}` : ''}
        </span>
        {canPreview ? (
          <button type="button" className="gc-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Open'}
          </button>
        ) : null}
        {url ? (
          <a className="gc-btn" href={url} target="_blank" rel="noopener noreferrer">
            {artifact.kind === 'file' ? 'Download' : 'New tab'}
          </a>
        ) : null}
      </div>
      {open && url ? (
        artifact.kind === 'image' ? (
          <img className="gc-artifact-view" src={url} alt={artifact.title} />
        ) : artifact.kind === 'audio' ? (
          <audio className="gc-artifact-view" src={url} controls preload="metadata" />
        ) : artifact.kind === 'video' ? (
          <video className="gc-artifact-view" src={url} controls preload="metadata" playsInline />
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
      {open && asked && onSubmit ? (
        <div ref={confirm} className="gc-artifact-submit" role="group" aria-label="Send to the agent">
          {'tooLarge' in asked ? (
            <span className="gc-artifact-submit-text">This page tried to send more than fits in a message.</span>
          ) : (
            <>
              <span className="gc-artifact-submit-text">This page wants to send the agent:</span>
              <pre className="gc-artifact-submit-data">{asked.json}</pre>
            </>
          )}
          <span className="gc-artifact-submit-actions">
            {'tooLarge' in asked ? null : (
              <button
                type="button"
                className="gc-btn gc-primary"
                onClick={() => {
                  setAsked(undefined);
                  onSubmit(artifact, asked.data);
                }}
              >
                Send to agent
              </button>
            )}
            <button type="button" className="gc-btn" onClick={() => setAsked(undefined)}>
              {'tooLarge' in asked ? 'Dismiss' : 'Discard'}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
