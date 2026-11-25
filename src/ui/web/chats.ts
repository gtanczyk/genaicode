import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '../../agents/sessions/group.js';
import { chatsWithoutAnswered, withoutAnswered } from '../needs-you.js';
import type { WebSessionListing } from './server.js';

/** How often the limits last seen, and the lists of the sidebar, are asked for again. */
export const LIMITS_EVERY_MS = 60_000;

export const NO_SESSIONS: SessionInfo[] = [];

/** What the sidebar and the Needs you page read of `/api/sessions`. */
export interface Chats {
  own: SessionInfo[];
  all: SessionInfo[];
  /** The questions hooks hold open, and the agents that take a reply to a session. */
  asks: NonNullable<WebSessionListing['asks']>;
  senders: NonNullable<WebSessionListing['senders']>;
  /** Asks again now: something was answered from here. */
  refresh(): void;
  /**
   * A hook's question was answered from here (or already elsewhere): it no longer waits, nor does
   * its session while no other question of it does, whatever the listing says until it is read again.
   */
  answered(ask: string): void;
  /** A reply went to this session: it works again, whatever the stores still say until they are read. */
  replied(session: SessionInfo): void;
}

const NO_LISTING: WebSessionListing = { sessions: NO_SESSIONS, errors: [] };
const NO_ASKS_GONE: ReadonlySet<string> = new Set();

/**
 * What the sidebar lists (`/api/sessions`): this app's chats of the last 30 days, and every
 * agent's sessions of the last 7. Asked again when `stamp` changes (a turn ended, another chat was
 * opened), every minute, when the window is looked at again, and after an answer given from here.
 * `token` is the page's API token: nothing is asked without one.
 */
export function useChats(token: string, enabled: boolean, stamp: string): Chats {
  const [own, setOwn] = useState<SessionInfo[]>(NO_SESSIONS);
  const [listing, setListing] = useState<WebSessionListing>(NO_LISTING);
  const [round, setRound] = useState(0);
  // The questions answered from here that a listing may still hold: forgotten once one does not.
  const [gone, setGone] = useState<ReadonlySet<string>>(NO_ASKS_GONE);
  const keepListing = useCallback((found: WebSessionListing) => {
    setListing(found);
    setGone((ids) => {
      const still = new Set((found.asks ?? []).map((ask) => ask.id));
      const kept = [...ids].filter((id) => still.has(id));
      return kept.length === ids.size ? ids : new Set(kept);
    });
  }, []);
  useEffect(() => {
    if (!enabled || !token) return;
    let current = true;
    const list = (query: string, keep: (listing: WebSessionListing) => void) =>
      fetch(`/api/sessions?${query}`, { headers: { 'x-genaicode-token': token } })
        .then((res) => (res.ok ? (res.json() as Promise<WebSessionListing>) : undefined))
        .then(
          (found) => {
            if (current && found) keep(found);
          },
          () => undefined,
        );
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void list('days=30&own=1', (found) => setOwn(found.sessions ?? []));
      void list('days=7', keepListing);
    };
    ask();
    const timer = window.setInterval(ask, LIMITS_EVERY_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [token, enabled, stamp, round]);
  return useMemo(() => {
    const shown = chatsWithoutAnswered(own, listing.sessions ?? NO_SESSIONS, listing.asks ?? [], gone);
    return {
      own: shown.own,
      all: shown.sessions,
      asks: shown.asks,
      senders: listing.senders ?? [],
      refresh: () => setRound((value) => value + 1),
      answered: (ask) => {
        // The own chats are settled now too: every agent's listing may be read again first and no
        // longer hold the question, while this one still says the chat waits on it.
        setOwn((sessions) => withoutAnswered(sessions, listing.asks ?? [], new Set([...gone, ask])).sessions);
        setGone((ids) => new Set([...ids, ask]));
        setRound((value) => value + 1);
      },
      replied: (session) => {
        const same = (one: SessionInfo) => one.source === session.source && one.id === session.id;
        const working = (one: SessionInfo): SessionInfo =>
          same(one) ? { ...one, state: 'active', waitingFor: undefined, updatedAt: Date.now() } : one;
        setOwn((sessions) => sessions.map(working));
        setListing((found) => ({ ...found, sessions: (found.sessions ?? []).map(working) }));
        setRound((value) => value + 1);
      },
    };
  }, [own, listing, gone]);
}
