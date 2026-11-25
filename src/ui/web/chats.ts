import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '../../agents/sessions/group.js';
import type { PendingAsk } from '../../agents/sessions/answer.js';
import { chatsWithoutAnswered, withoutAnswered } from '../needs-you.js';
import type { WebSessionListing } from './server.js';

/** How often the limits last seen, and the lists of the sidebar, are asked for again. */
export const LIMITS_EVERY_MS = 60_000;

export const NO_SESSIONS: SessionInfo[] = [];

/** What the sidebar and the Needs you page read of `/api/sessions`. */
export interface Chats {
  own: SessionInfo[];
  all: SessionInfo[];
  /** This app's chats have been read once: until then no session of `all` can be told to be another agent's. */
  ownKnown: boolean;
  /** The questions hooks hold open, and the agents that take a reply to a session. */
  asks: NonNullable<WebSessionListing['asks']>;
  senders: NonNullable<WebSessionListing['senders']>;
  /**
   * Why the last read of a listing failed, for each that did (every agent's sessions, this app's
   * chats), and the stores the last read of either listing could not read: while any is there, an
   * empty queue does not say nothing waits.
   */
  failed: string[];
  errors: WebSessionListing['errors'];
  /** Asks again now: something was answered from here. */
  refresh(): void;
  /**
   * A hook's question was answered from here (or already elsewhere): it no longer waits, nor does
   * its session while no other question of it does, whatever the listing says until it is read again.
   * `of` names that session (its agent and id), so it settles even before a listing of the questions
   * has arrived.
   */
  answered(ask: string, of?: AskedBy): void;
  /** A reply went to this session: it works again, whatever the stores still say until they are read. */
  replied(session: SessionInfo): void;
}

/** The session a hook's question was asked for. */
export type AskedBy = Pick<PendingAsk, 'agent' | 'session'>;

const NO_LISTING: WebSessionListing = { sessions: NO_SESSIONS, errors: [] };
const NO_ASKS_GONE: ReadonlyMap<string, AskedBy | undefined> = new Map();

/**
 * The questions a listing holds, and those answered from here it does not (yet) hold whose session
 * is known: a session settles once its last question is answered, listed or not.
 */
function knownAsks(asks: PendingAsk[], gone: ReadonlyMap<string, AskedBy | undefined>): PendingAsk[] {
  const listed = new Set(asks.map((ask) => ask.id));
  const more = [...gone].flatMap(([id, by]) => (by && !listed.has(id) ? [{ id, ...by, at: 0, pid: 0 }] : []));
  return more.length ? [...asks, ...more] : asks;
}

/** The stores either listing could not read, each once. */
function storeErrors(all: WebSessionListing['errors'], own: WebSessionListing['errors']): WebSessionListing['errors'] {
  if (!own.length) return all;
  const seen = new Set(all.map((error) => `${error.source}\n${error.message}`));
  const more = own.filter((error) => !seen.has(`${error.source}\n${error.message}`));
  return more.length ? [...all, ...more] : all;
}

/**
 * What the sidebar lists (`/api/sessions`): this app's chats of the last 30 days, and every
 * agent's sessions of the last 7. Asked again when `stamp` changes (a turn ended, another chat was
 * opened), every minute, when the window is looked at again, and after an answer given from here.
 * `token` is the page's API token: nothing is asked without one.
 */
export function useChats(token: string, enabled: boolean, stamp: string): Chats {
  const [own, setOwn] = useState<SessionInfo[]>(NO_SESSIONS);
  // Until this app's chats are known, a session of the index cannot be told to be another agent's.
  const [ownKnown, setOwnKnown] = useState(false);
  const [listing, setListing] = useState<WebSessionListing>(NO_LISTING);
  const [round, setRound] = useState(0);
  // Why the last read of each listing failed; absent once one is read.
  const [failedAll, setFailedAll] = useState<string>();
  const [failedOwn, setFailedOwn] = useState<string>();
  // The stores the last read of this app's chats could not read.
  const [ownErrors, setOwnErrors] = useState<WebSessionListing['errors']>([]);
  // The questions answered from here that a listing may still hold, with the session each was asked
  // for where known: forgotten once a listing does not hold it.
  const [gone, setGone] = useState<ReadonlyMap<string, AskedBy | undefined>>(NO_ASKS_GONE);
  const keepListing = useCallback((found: WebSessionListing) => {
    setListing(found);
    setGone((ids) => {
      const still = new Set((found.asks ?? []).map((ask) => ask.id));
      const kept = [...ids].filter(([id]) => still.has(id));
      return kept.length === ids.size ? ids : new Map(kept);
    });
  }, []);
  useEffect(() => {
    if (!enabled || !token) return;
    let current = true;
    const list = (query: string, keep: (listing: WebSessionListing) => void, fail: (why: string | undefined) => void) =>
      fetch(`/api/sessions?${query}`, { headers: { 'x-genaicode-token': token } })
        .then((res) => {
          if (!res.ok) throw new Error(`The server answered ${res.status}.`);
          return res.json() as Promise<WebSessionListing>;
        })
        .then(
          (found) => {
            if (!current) return;
            fail(undefined);
            keep(found);
          },
          (error: unknown) => {
            if (current) fail(error instanceof Error ? error.message : String(error));
          },
        );
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void list(
        'days=30&own=1',
        (found) => {
          setOwn(found.sessions ?? []);
          setOwnErrors(found.errors ?? []);
          setOwnKnown(true);
        },
        setFailedOwn,
      );
      void list('days=7', keepListing, setFailedAll);
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
    const shown = chatsWithoutAnswered(
      own,
      listing.sessions ?? NO_SESSIONS,
      knownAsks(listing.asks ?? [], gone),
      new Set(gone.keys()),
    );
    return {
      own: shown.own,
      all: shown.sessions,
      ownKnown,
      asks: shown.asks,
      senders: listing.senders ?? [],
      failed: [
        ...(failedAll ? [`every agent’s sessions: ${failedAll}`] : []),
        ...(failedOwn ? [`this app’s chats: ${failedOwn}`] : []),
      ],
      errors: storeErrors(listing.errors ?? [], ownErrors),
      refresh: () => setRound((value) => value + 1),
      answered: (ask, of) => {
        // The own chats are settled now too: every agent's listing may be read again first and no
        // longer hold the question, while this one still says the chat waits on it. The session the
        // question was asked for settles even where no listing of the questions has arrived yet.
        const now = new Map(gone).set(ask, of ?? gone.get(ask));
        setOwn(
          (sessions) => withoutAnswered(sessions, knownAsks(listing.asks ?? [], now), new Set(now.keys())).sessions,
        );
        setGone((ids) => new Map(ids).set(ask, of ?? ids.get(ask)));
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
  }, [own, ownKnown, listing, gone, failedAll, failedOwn, ownErrors]);
}
