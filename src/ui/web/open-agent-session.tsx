import { useState } from 'react';
import type { SessionInfo } from '../../agents/sessions/types.js';
import { copyText } from './onboarding.js';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Hand off only identifiers from the provider's own store. */
export function OpenAgentSession({ session }: { session: SessionInfo }) {
  const [copied, setCopied] = useState('');
  const { id, source, where } = session;
  let label: string;
  let href: string;
  if (where === 'cloud' && session.url && /^https?:\/\//i.test(session.url)) {
    href = session.url;
    label = `Open ${session.agent} session`;
  } else if (where !== 'local' || !uuid.test(id)) return null;
  else if (source === 'codex') {
    href = `codex://threads/${id}`;
    label = 'Open in Codex';
  } else if (
    source === 'claude' &&
    session.waitingFor !== 'approval' &&
    !session.turnInProgress &&
    session.state !== 'active'
  ) {
    href = `claude://resume?session=${id}`;
    label = 'Resume in Claude Desktop';
  } else if (source === 'antigravity') {
    const command = `agy --conversation ${id}`;
    return (
      <button
        type="button"
        className="btn sm ghost"
        title={command}
        onClick={async () => {
          if (await copyText(command)) setCopied(id);
          else window.prompt('Resume in Antigravity CLI', command);
        }}
      >
        {copied === id ? 'Copied agy command' : 'Copy agy command'}
      </button>
    );
  } else return null;
  return (
    <a className="btn sm ghost" href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}
