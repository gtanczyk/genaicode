import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { SessionEntry, SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalDecision } from '../agents/types.js';
import { useFollowScroll } from './follow-scroll.js';
import { formatDuration, formatUsage, relativePath, shortId, toolLabel, toolSummary, turnFooter } from './format.js';
import { Markdown } from './markdown.js';

/** A line from the host itself (not the agent), shown between turns. */
export interface ChatNotice {
  /** Stable key. */
  id: string | number;
  /** Shown after this many turns: 0 before the first turn, `state.turns.length` at the end. */
  afterTurn: number;
  text: ReactNode;
  tone?: 'info' | 'error';
}

export interface AgentChatProps {
  /**
   * The session to show, e.g. `session.get()` sent over SSE. Null or undefined (no session
   * yet) shows an empty, idle chat the user can type into.
   */
  state: SessionState | null | undefined;
  /** The user sent `text` (Enter or the Send button). Whitespace-only input is not sent. */
  onSend(text: string): void;
  /** The user pressed Stop or Esc while the agent works. Without it there is no Stop button. */
  onStop?(): void;
  /**
   * Answer an approval the agent asked for (`state.approvals`). Without it pending approvals
   * show as waiting, with no buttons.
   */
  onApprove?(id: string, decision: ApprovalDecision): void;
  /**
   * How a prompt bubble shows the text that was sent, e.g. to hide a context prefix the host
   * added. Return null to hide the bubble. `turn` is undefined for queued prompts and for
   * input sent while the agent works.
   */
  renderPrompt?(text: string, turn?: SessionTurn): ReactNode;
  /** Tool name as shown, e.g. without an MCP server prefix. Default: friendlier names for common tools. */
  formatToolName?(name: string): string;
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

  const rootClass = ['gc-chat', props.className].filter(Boolean).join(' ');
  const theme = props.theme && props.theme !== 'auto' ? props.theme : undefined;
  const agentName = state.agent || 'the agent';

  const send = () => {
    if (!draft.trim() || props.disabled) return;
    follow();
    props.onSend(draft);
    setDraft('');
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape' && running && props.onStop) props.onStop();
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
        pending={state.approvals}
        onApprove={props.onApprove}
        prompt={props.renderPrompt}
        toolName={props.formatToolName ?? toolLabel}
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
  const footer = props.renderFooter?.();

  return (
    <div className={rootClass} data-theme={theme} data-status={state.status} style={props.style}>
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
        <div className="gc-box">
          <textarea
            ref={input}
            rows={1}
            autoFocus={props.autoFocus}
            value={draft}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {running && props.onStop ? (
            <button type="button" className="gc-btn gc-danger" onClick={() => props.onStop?.()}>
              Stop
            </button>
          ) : null}
          <button type="button" className="gc-btn gc-primary" disabled={!draft.trim() || props.disabled} onClick={send}>
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
  prompt,
  toolName,
  fold,
}: {
  turn: SessionTurn;
  now: number;
  cwd: string;
  pending: SessionState['approvals'];
  onApprove?: AgentChatProps['onApprove'];
  prompt?: AgentChatProps['renderPrompt'];
  toolName: (name: string) => string;
  fold: boolean;
}) {
  const running = !turn.result;
  const bad = turn.result && !turn.result.ok;
  const shown = prompt ? prompt(turn.prompt, turn) : turn.prompt;
  const entry = (item: SessionEntry, i: number) => (
    <Entry
      key={i}
      entry={item}
      agent={turn.agent}
      cwd={cwd}
      pending={pending}
      onApprove={onApprove}
      prompt={prompt}
      toolName={toolName}
    />
  );
  return (
    <section className="gc-turn">
      {shown === null || shown === undefined || shown === false ? null : <div className="gc-prompt">{shown}</div>}
      {turn.entries.length ? (
        <div className="gc-agent-row">
          <div className="gc-avatar" title={turn.agent} aria-hidden="true">
            {turn.agent.slice(0, 2)}
          </div>
          <div className="gc-steps">
            {fold ? (
              <Folded turn={turn} pending={pending} toolName={toolName} entry={entry} />
            ) : (
              turn.entries.map(entry)
            )}
          </div>
        </div>
      ) : null}
      {running ? (
        <div className="gc-working">
          <span className="gc-spin" /> {turn.agent} is working
          {/* The ticking time stays out of the transcript's live region. */}
          <span aria-hidden="true">· {formatDuration(now - turn.startedAt)}</span>
        </div>
      ) : (
        <div className={`gc-turn-footer${bad ? ' gc-bad' : ''}`}>
          {turnFooter(turn, now)} · {turn.agent}
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
  prompt,
  toolName,
}: {
  entry: SessionEntry;
  agent: string;
  cwd: string;
  pending: SessionState['approvals'];
  onApprove?: AgentChatProps['onApprove'];
  prompt?: AgentChatProps['renderPrompt'];
  toolName: (name: string) => string;
}) {
  switch (entry.kind) {
    case 'text':
      return <Markdown text={entry.text} streaming={entry.streaming} />;
    case 'tool':
      return (
        <details className="gc-tool">
          <summary>
            <span className={`gc-state${entry.done ? (entry.isError ? ' gc-err' : ' gc-ok') : ''}`}>
              {entry.done ? entry.isError ? '✗' : '✓' : <span className="gc-spin" />}
            </span>
            <span className="gc-tool-name">{toolName(entry.name)}</span>
            <span className="gc-tool-arg">{toolSummary(entry.input, 200, cwd)}</span>
          </summary>
          <pre>{entry.output?.trim() || (entry.done ? 'No output.' : 'Running…')}</pre>
        </details>
      );
    case 'files':
      return (
        <div className="gc-files">
          <span>✎ Edited</span>
          {entry.paths.map((path) => (
            <code key={path}>{relativePath(path, cwd)}</code>
          ))}
        </div>
      );
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
  }
}
