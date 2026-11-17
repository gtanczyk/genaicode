/** Whether a key may spend more tokens now; `resetsAt` (epoch ms) when it may again. */
export interface LimitCheck {
  ok: boolean;
  resetsAt?: number;
}

/**
 * Daily token allowances. The backend asks `check` before every model call and reports what the
 * call used with `spend`. Back it with your store (Firestore, Redis, KV) when the backend runs on
 * more than one instance: `memoryLimiter` counts per process.
 */
export interface BackendLimiter {
  /** `key` is the user's id, the visitor's (`identify`), or undefined for an unknown visitor. */
  check(key: string | undefined): LimitCheck | Promise<LimitCheck>;
  spend(key: string | undefined, tokens: number): void | Promise<void>;
}

export interface MemoryLimiterOptions {
  /** Tokens one key may use per day (UTC). Default 200,000. */
  perKeyPerDay?: number;
  /** Tokens the whole backend may use per day (UTC). Default 2,000,000. */
  globalPerDay?: number;
  /** Keys counted per day; once full, a key not seen today waits for tomorrow. Default 100,000. */
  maxKeys?: number;
  /** For tests. */
  now?: () => number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Per-key and global daily token allowances, in this process's memory. */
export function memoryLimiter(options: MemoryLimiterOptions = {}): BackendLimiter {
  const perKey = options.perKeyPerDay ?? 200_000;
  const global = options.globalPerDay ?? 2_000_000;
  const maxKeys = options.maxKeys ?? 100_000;
  const now = options.now ?? Date.now;
  let day = -1;
  let total = 0;
  const used = new Map<string, number>();
  const roll = () => {
    const today = Math.floor(now() / DAY);
    if (today !== day) {
      day = today;
      total = 0;
      used.clear();
    }
    return (today + 1) * DAY;
  };
  return {
    check(key) {
      const resetsAt = roll();
      if (total >= global) return { ok: false, resetsAt };
      if (key !== undefined && (used.get(key) ?? 0) >= perKey) return { ok: false, resetsAt };
      // Many visitors (one key per address, say) must not grow this map without end.
      if (key !== undefined && !used.has(key) && used.size >= maxKeys) return { ok: false, resetsAt };
      return { ok: true };
    },
    spend(key, tokens) {
      roll();
      total += tokens;
      if (key !== undefined) used.set(key, (used.get(key) ?? 0) + tokens);
    },
  };
}
