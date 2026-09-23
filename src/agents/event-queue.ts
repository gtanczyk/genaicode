export interface EventQueueLimits {
  /** Events kept for a run nobody iterates yet. The oldest are dropped past this. */
  unreadItems: number;
  /** Approximate bytes kept for a run nobody iterates yet. The oldest events are dropped past this. */
  unreadBytes: number;
  /** While iterated: above this many buffered bytes, ask the producer to pause. */
  highWaterBytes: number;
  /** While iterated: at or below this many buffered bytes, let a paused producer resume. */
  lowWaterBytes: number;
}

const DEFAULT_LIMITS: EventQueueLimits = {
  unreadItems: 1_000,
  unreadBytes: 8 * 1024 * 1024,
  highWaterBytes: 8 * 1024 * 1024,
  lowWaterBytes: 1024 * 1024,
};

/**
 * Single-consumer queue bridging callbacks to `for await`, bounded by approximate size.
 *
 * Before anyone iterates, it keeps only the newest events within `unreadItems` and
 * `unreadBytes`, since a run awaited only through `result` needs none of them. While
 * iterated, it drops nothing: past `highWaterBytes` it calls `onPressure(true)` so the
 * producer stops reading, and `onPressure(false)` once the consumer catches up.
 * A consumer that stops iterating early releases the pressure and the rest is discarded.
 */
export class EventQueue<T> {
  /** Called with true when the producer should pause and false when it may resume. */
  onPressure: ((paused: boolean) => void) | undefined;
  private readonly items: { item: T; size: number }[] = [];
  private readonly limits: EventQueueLimits;
  private bytes = 0;
  private closed = false;
  private claimed = false;
  private abandoned = false;
  private pressured = false;
  private wake: (() => void) | undefined;
  private roomWaiters: (() => void)[] = [];

  constructor(
    private readonly sizeOf: (item: T) => number = () => 0,
    limits: Partial<EventQueueLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Approximate bytes currently buffered. */
  get bufferedBytes(): number {
    return this.bytes;
  }

  push(item: T): void {
    if (this.closed || this.abandoned) return;
    const size = this.sizeOf(item);
    this.items.push({ item, size });
    this.bytes += size;
    if (!this.claimed) {
      // The newest event always stays, so `done` survives however large the ones before it were.
      while (
        this.items.length > 1 &&
        (this.items.length > this.limits.unreadItems || this.bytes > this.limits.unreadBytes)
      ) {
        this.bytes -= this.items.shift()!.size;
      }
    } else if (!this.pressured && this.bytes > this.limits.highWaterBytes) {
      this.setPressure(true);
    }
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  /** Resolve once the producer may go on: the queue is below its high-water mark, or nobody reads it. */
  room(): Promise<void> {
    if (!this.pressured) return Promise.resolve();
    return new Promise((resolve) => this.roomWaiters.push(resolve));
  }

  async *iterate(): AsyncGenerator<T> {
    if (this.claimed) throw new Error('An AgentRun can be iterated only once.');
    this.claimed = true;
    try {
      for (;;) {
        const next = this.items.shift();
        if (next !== undefined) {
          this.bytes -= next.size;
          if (this.pressured && this.bytes <= this.limits.lowWaterBytes) this.setPressure(false);
          yield next.item;
          continue;
        }
        if (this.closed) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
    } finally {
      // Done, or the consumer broke out early: nothing reads further events, so do not hold the producer.
      this.abandoned = true;
      this.items.length = 0;
      this.bytes = 0;
      if (this.pressured) this.setPressure(false);
    }
  }

  private setPressure(paused: boolean): void {
    this.pressured = paused;
    this.onPressure?.(paused);
    if (!paused) {
      const waiters = this.roomWaiters;
      this.roomWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}

/** A cheap size estimate for a JSON-like value: string lengths plus a few bytes per other value. */
export function approximateSize(value: unknown, depth = 0): number {
  if (typeof value === 'string') return value.length;
  if (value === null || typeof value !== 'object' || depth > 8) return 8;
  let size = 8;
  if (Array.isArray(value)) {
    for (const item of value) size += approximateSize(item, depth + 1);
  } else {
    for (const [key, item] of Object.entries(value)) size += key.length + approximateSize(item, depth + 1);
  }
  return size;
}
