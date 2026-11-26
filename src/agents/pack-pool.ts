/** Shared capacity and Git mutations for the packs of one UI server. */
export class PackPool {
  private used = 0;
  private readonly waiting = new Set<() => void>();
  private readonly repositories = new Map<string, Promise<unknown>>();
  constructor(readonly capacity = 8) {}

  take(): (() => void) | undefined {
    if (this.used >= this.capacity) return;
    this.used++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.used--;
      this.waiting.values().next().value?.();
    };
  }

  async acquire(signal: AbortSignal, progress?: () => void): Promise<() => void> {
    signal.throwIfAborted();
    const free = this.take();
    if (free) return free;
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.waiting.delete(wake);
        clearInterval(heartbeat);
        clearTimeout(deadline);
        signal.removeEventListener('abort', cancel);
      };
      const wake = () => {
        const release = this.take();
        if (!release) return;
        finish();
        resolve(release);
      };
      const cancel = () => {
        finish();
        reject(new Error('Stopped waiting for a pack worker.'));
      };
      const heartbeat = setInterval(() => progress?.(), 15_000);
      const deadline = setTimeout(() => {
        finish();
        reject(new Error('All pack workers are busy in other chats. Try again later.'));
      }, 240_000);
      this.waiting.add(wake);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  async inRepo<T>(repo: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.repositories.get(repo) ?? Promise.resolve();
    const work = prior.then(operation, operation);
    this.repositories.set(repo, work);
    try {
      return await work;
    } finally {
      if (this.repositories.get(repo) === work) this.repositories.delete(repo);
    }
  }
}
