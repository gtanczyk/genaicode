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
