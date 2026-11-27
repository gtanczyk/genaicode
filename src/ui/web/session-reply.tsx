import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import type { SandboxPolicy } from '../../agents/types.js';
import { sessionKey } from '../sidebar.js';
import type { SessionInfo } from '../../agents/sessions/types.js';

/**
 * A reply being written: its text and the sandbox chosen for it (`''`: the driver's default), and
 * whether it is on its way (the editor takes no edits until it lands or fails), and why the last
 * try to send it failed: an editor shown again says so too.
 */
export interface SessionReplyDraft {
  prompt: string;
  sandbox: string;
  sending?: boolean;
  error?: string;
}
const EMPTY_DRAFT: SessionReplyDraft = { prompt: '', sandbox: '' };

type ReplyAttempt = {
  session: SessionInfo;
  from: 'queue' | 'sessions';
  at: number;
} & ({ phase: 'pending' } | { phase: 'completed' | 'failed'; text: string });

function useReplyEditors() {
  const [attempts, setAttempts] = useState<ReadonlyMap<string, ReplyAttempt>>(new Map());
  const record = (attempt: ReplyAttempt) =>
    setAttempts((previous) => {
      const next = new Map(previous);
      const key = sessionKey(attempt.session);
      next.delete(key);
      next.set(key, attempt);
      return next;
    });
  const [replyTo, setReplyTo] = useState<string>();
  const [drafts, setDrafts] = useState<ReadonlyMap<string, SessionReplyDraft>>(new Map());
  const keepDraft = (key: string, draft: SessionReplyDraft | undefined) =>
    setDrafts((all) => {
      const next = new Map(all);
      if (draft) next.set(key, draft);
      else next.delete(key);
      return next;
    });
  const closeReply = (key: string) => {
    keepDraft(key, undefined);
    setAttempts((previous) => {
      if (previous.get(key)?.phase !== 'failed') return previous;
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
    setReplyTo((current) => (current === key ? undefined : current));
  };
  return { attempts, record, drafts, keepDraft, replyTo, setReplyTo, closeReply };
}

const ReplyEditors = createContext<ReturnType<typeof useReplyEditors> | null>(null);

/** The window owns session replies while their row, transcript or queue card comes and goes. */
export function SessionReplies({ children }: { children: ReactNode }) {
  const editors = useReplyEditors();
  return <ReplyEditors.Provider value={editors}>{children}</ReplyEditors.Provider>;
}

export function useSessionReplyDrafts() {
  const editors = useContext(ReplyEditors);
  if (!editors) throw new Error('Session replies need a SessionReplies provider.');
  return editors;
}

export function ReplyStatus({ attempt }: { attempt: ReplyAttempt }) {
  const { session } = attempt;
  if (attempt.phase === 'failed')
    return (
      <p role="alert" className="errors">
        {attempt.text}
      </p>
    );
  if (attempt.phase === 'pending')
    return (
      <p role="status" className="thread-availability">
        Waiting for {session.agent} to finish the turn started from Genaicode…
      </p>
    );
  return (
    <details className="thread-receipt">
      <summary role="status">
        Last reply · {session.agent} completed the turn from Genaicode ·{' '}
        <time dateTime={new Date(attempt.at).toISOString()}>
          {new Date(attempt.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </time>
      </summary>
      {attempt.text && <p>{attempt.text}</p>}
      {session.agent === 'claude' && (
        <p>
          To load this turn in Claude Code, reopen the conversation with <code>claude --resume</code> in its project
          directory.
        </p>
      )}
    </details>
  );
}

export function SessionReply({
  session,
  token,
  sandboxes,
  from,
  onSent,
  onClose,
  draft,
  onDraft,
}: {
  session: SessionInfo;
  token: string;
  sandboxes: readonly SandboxPolicy[];
  from: ReplyAttempt['from'];
  onSent(reply: string): void;
  onClose(): void;
  /** What is typed, kept by the caller so it outlives this editor. Default: kept here. */
  draft?: SessionReplyDraft;
  onDraft?(draft: SessionReplyDraft): void;
}) {
  const { record } = useSessionReplyDrafts();
  const [own, setOwn] = useState<SessionReplyDraft>(EMPTY_DRAFT);
  // Kept with the draft: an editor shown again while the reply is on its way takes no edits either.
  const { prompt, sandbox, sending = false, error } = draft ?? own;
  const keep = (next: SessionReplyDraft) => (onDraft ? onDraft(next) : setOwn(next));
  const setPrompt = (value: string) => keep({ prompt: value, sandbox, error });
  const setSandbox = (value: string) => keep({ prompt, sandbox: value, error });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !prompt.trim()) return;
    keep({ prompt, sandbox, sending: true });
    record({ session, from, at: Date.now(), phase: 'pending' });
    let reply: string;
    let delivery = 'Delivery to this session is unconfirmed.';
    try {
      const target = [session.source, session.id].map(encodeURIComponent).join('/');
      const response = await fetch(`/api/sessions/${target}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ prompt, sandbox: sandbox || undefined }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (result.delivery === 'not-sent') delivery = 'The message did not reach this session.';
        if (result.delivery === 'reached') delivery = 'The message reached this session.';
        throw new Error(result.error ?? `The server answered ${response.status}.`);
      }
      reply = result.text ?? '';
    } catch (cause) {
      const reason = `${cause instanceof Error ? cause.message : String(cause)} ${delivery}`;
      record({ session, from, at: Date.now(), phase: 'failed', text: reason });
      keep({ prompt, sandbox, error: reason });
      return;
    } finally {
      window.dispatchEvent(new Event('genaicode-history-changed'));
    }
    if (!onDraft) setOwn({ prompt, sandbox });
    record({ session, from, at: Date.now(), phase: 'completed', text: reply });
    onSent(reply);
  };
  return (
    <form className="session-reply" onSubmit={submit}>
      <small>
        {session.agent === 'claude'
          ? 'Genaicode resumes this conversation in a separate Claude Code process. An already-open terminal may still show the previous turn.'
          : `Genaicode resumes the saved ${session.agent} session for this turn.`}
      </small>
      <textarea
        aria-label={`Message to ${session.agent}`}
        placeholder={`Message ${session.agent}…`}
        autoFocus
        maxLength={32000}
        required
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={sending}
      />
      <div>
        <label>
          Sandbox{' '}
          <select value={sandbox} disabled={sending} onChange={(event) => setSandbox(event.target.value)}>
            <option value="">Driver default</option>
            {sandboxes.map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onClose} disabled={sending}>
          Cancel
        </button>
        <button type="submit" disabled={sending || !prompt.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error ? (
        <p className="errors" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
