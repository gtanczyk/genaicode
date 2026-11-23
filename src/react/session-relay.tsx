import type { SessionSendStatus } from '../agents/sessions/send-tool.js';
import { firstLine, formatDuration, shortId } from './format.js';
import { Markdown, trimTrailingSlashes } from './markdown.js';

/** Live state of a message relayed to another local agent session (`sessions_send`). */
export interface ChatSessionRelay {
  /** Target agent name, e.g. `claude`. */
  agent: string;
  /** Target session id. */
  sessionId: string;
  /** Target session title, when known. */
  title?: string;
  /** Target session working directory. */
  cwd: string;
  /** The message sent to the target session. */
  prompt: string;
  status: SessionSendStatus;
  /** When the send was queued, or when the target session started working on it. */
  startedAt: number;
  /** When the target session's turn ended (`answered` or `failed`). */
  endedAt?: number;
  /** Latest running tool name while `status === 'working'`, formatted via `toolName`. */
  tool?: string;
  /** Short live status line while `status === 'working'` (e.g. waiting for approval or latest text preview). */
  activity?: string;
  /** The target session's Markdown reply when `status === 'answered'`. */
  reply?: string;
  /** Failure explanation when `status === 'failed'`. */
  error?: string;
}

/** Last directory name of a working directory path, for a compact project chip. */
export function relayProjectName(cwd: string): string {
  const trimmed = trimTrailingSlashes(cwd);
  if (!trimmed) return cwd;
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash >= 0 ? trimmed.slice(slash + 1) || cwd : trimmed;
}

/** Live card for a cross-session message (`sessions_send`): Queued → Working → Answered / Failed. */
export function SessionRelayCard({
  relay,
  cwd,
  now,
  toolName,
  imageUrl,
  remoteImages,
}: {
  relay: ChatSessionRelay;
  /** Active chat's project root, used alongside `relay.cwd` to scope clickable file links in replies. */
  cwd: string;
  now: number;
  toolName: (name: string) => string;
  imageUrl?: (path: string) => string | undefined;
  remoteImages?: 'click' | 'load';
}) {
  const project = relayProjectName(relay.cwd);
  const subtitle = relay.title || shortId(relay.sessionId);
  const working = relay.status === 'working';
  const duration = working
    ? formatDuration(now - relay.startedAt)
    : relay.endedAt !== undefined && relay.endedAt - relay.startedAt >= 1000
      ? formatDuration(relay.endedAt - relay.startedAt)
      : '';
  const statusLabel =
    relay.status === 'queued'
      ? 'Queued'
      : working
        ? `Working · ${duration}`
        : relay.status === 'answered'
          ? duration
            ? `Answered · ${duration}`
            : 'Answered'
          : 'Failed';
  const sentPreview = firstLine(relay.prompt);
  const liveStep = working ? (relay.tool ? toolName(relay.tool) : relay.activity) : undefined;

  return (
    <section className="gc-relay" data-status={relay.status} aria-label={`Message to ${relay.agent}`}>
      <div className="gc-relay-head">
        <span className="gc-avatar gc-relay-avatar" aria-hidden="true">
          {relay.agent.slice(0, 2)}
        </span>
        <div className="gc-relay-who">
          <div className="gc-relay-top">
            <strong className="gc-relay-agent">{relay.agent}</strong>
            {project ? (
              <span className="gc-relay-project" title={relay.cwd}>
                {project}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <div className="gc-relay-title" title={relay.title || relay.sessionId}>
              {subtitle}
            </div>
          ) : null}
        </div>
        <span className="gc-relay-status" data-status={relay.status} role="status">
          {working ? <span className="gc-spin" aria-hidden="true" /> : null}
          {statusLabel}
        </span>
      </div>

      {relay.prompt ? (
        <details className="gc-relay-sent">
          <summary>
            <span className="gc-relay-sent-label">Sent</span>
            <span className="gc-relay-sent-preview">{sentPreview}</span>
          </summary>
          <div className="gc-relay-sent-full">{relay.prompt}</div>
        </details>
      ) : null}

      {relay.status === 'queued' ? <div className="gc-relay-live">Waiting for its current turn to finish…</div> : null}

      {working && liveStep ? (
        <div className="gc-relay-live">
          <span className="gc-relay-now">Now</span>
          <span>{liveStep}</span>
        </div>
      ) : null}

      {relay.status === 'answered' ? (
        relay.reply ? (
          <div className="gc-relay-body">
            <Markdown
              text={relay.reply}
              fileBase={relay.cwd}
              fileRoot={[relay.cwd, cwd].filter(Boolean)}
              imageUrl={imageUrl}
              remoteImages={remoteImages}
            />
          </div>
        ) : (
          <div className="gc-relay-live">Took the message.</div>
        )
      ) : null}

      {relay.status === 'failed' ? (
        <div className="gc-relay-body gc-err" role="alert">
          {relay.error || 'Could not deliver the message.'}
        </div>
      ) : null}
    </section>
  );
}
