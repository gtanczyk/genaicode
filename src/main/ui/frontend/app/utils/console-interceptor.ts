import { ConsoleLogEntry, ConsoleLogLevel } from '../../../../../main/common/console-types.js';

/**
 * Callback function type for handling console log updates
 */
export type ConsoleLogCallback = (logs: ConsoleLogEntry[]) => Promise<void>;

/**
 * Intercepts console methods and maintains a buffer of console log entries.
 * Calls a provided callback whenever new logs are added.
 */
export class ConsoleInterceptor {
  private buffer: ConsoleLogEntry[] = [];
  private readonly maxBufferSize: number;
  private readonly callback: ConsoleLogCallback;

  /**
   * Creates a new ConsoleInterceptor instance
   * @param maxBufferSize - Maximum number of log entries to keep in buffer (default: 1000)
   * @param callback - Function to call with updated logs buffer
   */
  constructor(maxBufferSize = 1000, callback: ConsoleLogCallback) {
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
        this._addToBuffer(level, args);
        originalMethod.apply(console, args);
      };
    });
  }

  /**
   * Formats log arguments into a single message string
   */
  private _formatMessage(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  }

  /**
   * Adds a log entry to the buffer and calls the callback
   */
  private _addToBuffer(level: ConsoleLogLevel, args: unknown[]) {
    const entry: ConsoleLogEntry = {
      timestamp: Date.now(),
      level,
      message: this._formatMessage(args),
      args,
    };

    this.buffer.push(entry);

    // Maintain circular buffer
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // Call the callback with updated buffer
    this.callback(this.buffer).catch((error) => {
      // Use original console.warn to avoid recursion
      const originalWarn = console.warn;
      originalWarn.call(console, 'ConsoleInterceptor: Failed to execute callback:', error);
    });
  }

  /**
   * Gets the current buffer of log entries
   */
  public getBuffer(): ConsoleLogEntry[] {
    return [...this.buffer];
  }

  /**
   * Clears the log buffer
   */
  public clearBuffer(): void {
    this.buffer = [];
  }
}
