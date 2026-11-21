import { useState, type FormEvent } from 'react';
import type { SandboxPolicy } from '../../agents/types.js';
import type { SessionInfo } from '../../agents/sessions/types.js';

export function SessionReply({
  session,
  token,
  sandboxes,
  onSent,
  onClose,
}: {
  session: SessionInfo;
  token: string;
  sandboxes: readonly SandboxPolicy[];
  onSent(reply: string): void;
  onClose(): void;
}) {
  const [prompt, setPrompt] = useState('');
  const [sandbox, setSandbox] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !prompt.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      const target = [session.source, session.id].map(encodeURIComponent).join('/');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers['x-genaicode-token'] = token;
      const response = await fetch(`/api/sessions/${target}/send`, {
        method: 'POST',
        headers,
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
