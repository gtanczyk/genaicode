import { useState, type FormEvent } from 'react';
import type { SandboxPolicy } from '../../agents/types.js';
import type { SessionInfo } from '../../agents/sessions/types.js';

/** A reply being written: its text and the sandbox chosen for it (`''`: the driver's default). */
export interface SessionReplyDraft {
  prompt: string;
  sandbox: string;
}
const EMPTY_DRAFT: SessionReplyDraft = { prompt: '', sandbox: '' };

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
  const { prompt, sandbox } = draft ?? own;
  const keep = (next: SessionReplyDraft) => (onDraft ? onDraft(next) : setOwn(next));
  const setPrompt = (value: string) => keep({ prompt: value, sandbox });
  const setSandbox = (value: string) => keep({ prompt, sandbox: value });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !prompt.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      const target = [session.source, session.id].map(encodeURIComponent).join('/');
      const response = await fetch(`/api/sessions/${target}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ prompt, sandbox: sandbox || undefined }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? `The server answered ${response.status}.`);
      onSent(result.text ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
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
