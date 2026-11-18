import type { SessionInfo } from '../agents/sessions/index.js';

/** What the Sessions view narrows the list by. */
export interface SessionFilter {
  /** Words that must all appear in the title, prompts, directory, branch, agent or id. */
  text?: string;
  agent?: string;
  /** A `SessionActivity`, or `open` for everything but sessions that wait for the user. */
  state?: string;
}

export function filterSessions(sessions: readonly SessionInfo[], filter: SessionFilter): SessionInfo[] {
  const words = (filter.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    if (filter.agent && session.agent !== filter.agent) return false;
    if (filter.state === 'open' ? session.state === 'waiting' : filter.state && session.state !== filter.state)
      return false;
    if (!words.length) return true;
    const hay = [
      session.title,
      session.firstPrompt,
      session.lastPrompt,
      session.cwd,
      session.repository,
      session.branch,
      session.agent,
      session.id,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** `5m`, `3h`, `12d`: how long ago, in the largest unit that fits. */
export function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/** The command that continues a local session in the terminal; none for a cloud session. */
export function resumeCommand(session: SessionInfo): string | undefined {
  if (session.where !== 'local') return undefined;
  const quote = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
  return `genaicode chat -a ${quote(session.agent)}${session.cwd ? ` -C ${quote(session.cwd)}` : ''} -r ${quote(session.id)}`;
}
