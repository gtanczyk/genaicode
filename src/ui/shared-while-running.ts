/**
 * `read`, with callers that ask for the same `key` while a read is under way getting that read's
 * answer instead of starting another. Nothing is kept once it ends: the next asker reads afresh.
 */
export function sharedWhileRunning<Q, R>(key: (query: Q) => string, read: (query: Q) => Promise<R>) {
  const running = new Map<string, Promise<R>>();
  return (query: Q): Promise<R> => {
    const id = key(query);
    let pending = running.get(id);
    if (!pending) {
      pending = read(query).finally(() => running.delete(id));
      running.set(id, pending);
    }
    return pending;
  };
}

/**
 * A session listing for the page (`/api/sessions`), shared by those who ask for it at once. The
 * sidebar's two listings, the Home page and every open window ask at the same moments (a turn
 * starting or ending), each with a cutoff a few milliseconds from the others': the listing is read
 * from the start of the cutoff's minute, so they share it, and each gets the sessions after its own.
 */
export function sessionsOncePerMinute<L extends { sessions: readonly { updatedAt: number }[] }>(
  read: (query: { own?: boolean; since?: number }) => Promise<L>,
): (query: { own?: boolean; since?: number }) => Promise<L> {
  const shared = sharedWhileRunning(
    (query: { own?: boolean; since?: number }) => `${query.own ? 'own' : 'all'}:${query.since ?? ''}`,
    read,
  );
  return async ({ own, since }) => {
    const from = since === undefined ? undefined : Math.floor(since / 60_000) * 60_000;
    const listing = await shared({ ...(own ? { own } : {}), ...(from !== undefined ? { since: from } : {}) });
    if (since === undefined || since === from) return listing;
    return { ...listing, sessions: listing.sessions.filter((session) => session.updatedAt >= since) };
  };
}
