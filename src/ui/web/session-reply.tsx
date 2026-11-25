import { useState, type FormEvent } from 'react';
import type { SandboxPolicy } from '../../agents/types.js';
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

export function useSessionReplyDrafts() {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, SessionReplyDraft>>(new Map());
  const keepDraft = (key: string, draft: SessionReplyDraft | undefined) =>
    setDrafts((all) => {
      const next = new Map(all);
      if (draft) next.set(key, draft);
      else next.delete(key);
      return next;
    });
  return { drafts, keepDraft };
}

export function SessionReply({
  session,
  token,
  sandboxes,
  onSent,
  onClose,
  draft,
  onDraft,
}: {
  session: SessionInfo;
  token: string;
  sandboxes: readonly SandboxPolicy[];
  onSent(reply: string): void;
  onClose(): void;
  /** What is typed, kept by the caller so it outlives this editor. Default: kept here. */
  draft?: SessionReplyDraft;
  onDraft?(draft: SessionReplyDraft): void;
}) {
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
      // The caller drops a draft it keeps; one kept here stays, no longer sending.
      if (!onDraft) setOwn({ prompt, sandbox });
      onSent(result.text ?? '');
    } catch (cause) {
      keep({ prompt, sandbox, error: `${cause instanceof Error ? cause.message : String(cause)} ${delivery}` });
    }
  };
  return (
    <form className="session-reply" onSubmit={submit}>
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
