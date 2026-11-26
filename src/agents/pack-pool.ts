/** Shared capacity and Git mutations for the packs of one UI server. */
export class PackPool {
  private readonly holders = new Map<symbol, string>();
  private readonly waiting = new Set<() => void>();
  private readonly repositories = new Map<string, Promise<unknown>>();
  constructor(
    readonly capacity = 8,
    private readonly title = (id: string) => id,
  ) {}

  get busyChats() {
    return [...new Set(this.holders.values())].filter(Boolean).map(this.title);
  }

  take(chat = ''): (() => void) | undefined {
    if (this.holders.size >= this.capacity) return;
    const slot = Symbol();
    this.holders.set(slot, chat);
    return () => {
      if (!this.holders.delete(slot)) return;
      this.waiting.values().next().value?.();
    };
  }

  async acquire(signal: AbortSignal, progress?: () => void, chat = ''): Promise<() => void> {
    signal.throwIfAborted();
    const free = this.take(chat);
    if (free) return free;
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.waiting.delete(wake);
        clearInterval(heartbeat);
        clearTimeout(deadline);
        signal.removeEventListener('abort', cancel);
      };
      const wake = () => {
        const release = this.take(chat);
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
        reject(new Error(`All ${this.capacity} pack workers are busy. ${this.busyChats.join(', ')}. Try again later.`));
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
