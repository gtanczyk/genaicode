import { ConsoleLogEntry, ConsoleLogLevel } from '../main/common/console-types.js';

/**
 * Callback function type for handling console log updates
 * NOTE: The callback receives ONLY NEW log entries since the previous callback.
 */
export type ConsoleLogCallback = (logs: ConsoleLogEntry[]) => Promise<void>;

/**
 * Intercepts console methods and maintains a buffer of console log entries.
 * Calls a provided callback whenever new logs are added.
 *
 * Changes:
 * - Only NEW entries are sent to the callback (not the whole buffer)
 * - Each entry's message is capped to a max length to avoid large payloads
 * - Batch multiple console calls in the same tick into a single callback invocation
 */
export class ConsoleInterceptor {
  private buffer: ConsoleLogEntry[] = [];
  private readonly maxBufferSize: number;
  private readonly callback: ConsoleLogCallback;

  // Batching state
  private pendingBatch: ConsoleLogEntry[] = [];
  private flushScheduled = false;

  // Reasonable per-entry message cap (can be tweaked if needed)
  private static readonly MAX_ENTRY_MESSAGE_LENGTH = 2000;

  /**
   * Creates a new ConsoleInterceptor instance
   * @param maxBufferSize - Maximum number of log entries to keep in buffer (default: 50)
   * @param callback - Function to call with NEW logs (delta) when available
   */
  constructor(maxBufferSize = 50, callback: ConsoleLogCallback) {
    this.maxBufferSize = maxBufferSize;
    this.callback = callback;
    this._wrapConsoleMethods();
  }

  /**
   * Wraps all console methods to intercept log calls
   */
  private _wrapConsoleMethods() {
    const methodsToWrap: ConsoleLogLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'assert'];

    methodsToWrap.forEach((level) => {
      const originalMethod = console[level as keyof Console] as (...args: unknown[]) => void;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[level] = (...args: unknown[]) => {
        this._enqueue(level, args);
        originalMethod.apply(console, args);
      };
    });
  }

  /**
   * Formats log arguments into a single message string and enforces max length
   */
  private _formatMessage(args: unknown[]): string {
    const msg = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const maxLen = ConsoleInterceptor.MAX_ENTRY_MESSAGE_LENGTH;
    return msg.length > maxLen ? msg.slice(0, maxLen) + ` … [${msg.length - maxLen} more chars]` : msg;
  }

  /**
   * Enqueue a new log entry and schedule a batched flush
   */
  private _enqueue(level: ConsoleLogLevel, args: unknown[]) {
    const entry: ConsoleLogEntry = {
      timestamp: Date.now(),
      level,
      message: this._formatMessage(args),
      args,
    };

    // Append to full buffer (bounded)
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.splice(0, this.buffer.length - this.maxBufferSize);
    }

    // Add to pending batch and schedule a single microtask flush
    this.pendingBatch.push(entry);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // Use microtask to coalesce synchronously executed console.* calls
      queueMicrotask(() => this._flush());
    }
  }

  /**
   * Flush the pending batch to the callback (delta only)
   */
  private _flush() {
    if (this.pendingBatch.length === 0) {
      this.flushScheduled = false;
      return;
    }

    const batch = this.pendingBatch;
    this.pendingBatch = [];
    this.flushScheduled = false;

    this.callback(batch).catch((error) => {
      // Use original console.warn to avoid recursion
      const originalWarn = console.warn;
      originalWarn.call(console, 'ConsoleInterceptor: Failed to execute callback:', error);
    });
  }

  /**
   * Gets a copy of the current buffer of log entries
   */
  public getBuffer(): ConsoleLogEntry[] {
    return [...this.buffer];
  }

  /**
   * Clears the log buffer
   */
  public clearBuffer(): void {
    this.buffer = [];
    this.pendingBatch = [];
    this.flushScheduled = false;
  }
}
