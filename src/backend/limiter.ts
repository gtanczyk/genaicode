/** Whether a key may spend more tokens now; `resetsAt` (epoch ms) when it may again. */
export interface LimitCheck {
  ok: boolean;
  resetsAt?: number;
}

/**
 * Daily token allowances. Before every model call the backend `reserve`s what the call may use
 * at most; after it, `spend` replaces that hold with what the call used. Two calls that start
 * together cannot both take the same rest of an allowance, as long as `reserve` checks and holds
 * in one step (a transaction in your store). Back it with your store (Firestore, Redis, KV) when
 * the backend runs on more than one instance: `memoryLimiter` counts per process.
 *
 * `key` is the user's id, the visitor's (`identify`), or undefined for an unknown visitor.
 */
export interface BackendLimiter {
  /** Whether the key has anything left now (for `GET /info` and before a turn starts). */
  check(key: string | undefined): LimitCheck | Promise<LimitCheck>;
  /** Hold `tokens` for one model call, if the key and the backend have anything left. */
  reserve(key: string | undefined, tokens: number): LimitCheck | Promise<LimitCheck>;
  /** The call ended: count the `tokens` it used and let go of the `reserved` hold. */
  spend(key: string | undefined, tokens: number, reserved: number): void | Promise<void>;
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
  let totalHeld = 0;
  const used = new Map<string, number>();
  // Tokens held by calls still running; they carry over midnight, their spend comes after it.
  const held = new Map<string, number>();
  const roll = () => {
    const today = Math.floor(now() / DAY);
    if (today !== day) {
      day = today;
      total = 0;
      used.clear();
    }
    return (today + 1) * DAY;
  };
  const left = (key: string | undefined): LimitCheck => {
    const resetsAt = roll();
    if (total + totalHeld >= global) return { ok: false, resetsAt };
    if (key === undefined) return { ok: true };
    if ((used.get(key) ?? 0) + (held.get(key) ?? 0) >= perKey) return { ok: false, resetsAt };
    // Many visitors (one key per address, say) must not grow these maps without end.
    if (!used.has(key) && !held.has(key) && used.size >= maxKeys) return { ok: false, resetsAt };
    return { ok: true };
  };
  return {
    check: left,
    reserve(key, tokens) {
      const answer = left(key);
      if (!answer.ok) return answer;
      // The hold must fit, or two calls could each take the same rest.
      if (total + totalHeld + tokens > global) return { ok: false, resetsAt: roll() };
      if (key !== undefined && (used.get(key) ?? 0) + (held.get(key) ?? 0) + tokens > perKey) {
        return { ok: false, resetsAt: roll() };
      }
      totalHeld += tokens;
      if (key !== undefined) held.set(key, (held.get(key) ?? 0) + tokens);
      return answer;
    },
    spend(key, tokens, reserved) {
      roll();
      total += tokens;
      totalHeld = Math.max(0, totalHeld - reserved);
      if (key === undefined) return;
      used.set(key, (used.get(key) ?? 0) + tokens);
      const still = (held.get(key) ?? 0) - reserved;
      if (still > 0) held.set(key, still);
      else held.delete(key);
    },
  };
}
