export type ErrorClass = 'transient' | 'permanent' | 'unknown';

export interface ClassifiedError {
  class: ErrorClass;
  retryable: boolean;
  reason: string;
  status?: number;
  code?: string;
  cause: unknown;
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Classify a provider/SDK error for application-owned retry loops.
 *
 * GenAIcode does not retry automatically. Use this helper (or your own policy)
 * inside ordinary application control flow. See docs/retry.md.
 */
export function classifyError(error: unknown): ClassifiedError {
  const status = readStatus(error);
  const code = readCode(error);
  const message = messageOf(error).toLowerCase();

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { class: 'permanent', retryable: false, reason: 'aborted', cause: error };
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return { class: 'transient', retryable: true, reason: `network:${code}`, code, cause: error };
  }
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) {
    return {
      class: 'transient',
      retryable: true,
      reason: `http:${status}`,
      status,
      code,
      cause: error,
    };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      class: 'permanent',
      retryable: false,
      reason: `http:${status}`,
      status,
      code,
      cause: error,
    };
  }
  if (
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('unavailable') ||
    message.includes('overloaded')
  ) {
    return { class: 'transient', retryable: true, reason: 'message-heuristic', status, code, cause: error };
  }
  if (
    message.includes('invalid') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('permission') ||
    message.includes('not found')
  ) {
    return { class: 'permanent', retryable: false, reason: 'message-heuristic', status, code, cause: error };
  }

  return { class: 'unknown', retryable: false, reason: 'unclassified', status, code, cause: error };
}

export function isRetryable(error: unknown): boolean {
  return classifyError(error).retryable;
}

export interface RetryOptions {
  attempts?: number;
  /** Base delay in ms; doubles each attempt. Defaults to 250. */
  delayMs?: number;
  /** Max delay cap in ms. Defaults to 5000. */
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Explicit retry helper for application code. Not wired into the client by default.
 *
 * Idempotency: only wrap operations that are safe to repeat (most pure generation
 * calls are; tool side effects are not unless the application makes them idempotent).
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const shouldRetry = options.shouldRetry ?? ((error) => isRetryable(error));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const wait = Math.min(maxDelayMs, delayMs * 2 ** (attempt - 1));
      options.onRetry?.({ attempt, error, delayMs: wait });
      await sleep(wait, options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
