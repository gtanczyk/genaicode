/**
 * The part of the browser's Prompt API (`LanguageModel`, Gemini Nano in Chrome 148+) that
 * genaicode uses. Typed here because TypeScript's DOM library does not have it yet.
 */
export interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LanguageModelPromptOptions {
  signal?: AbortSignal;
  /** A JSON Schema the reply must match. */
  responseConstraint?: Record<string, unknown>;
  /** The prompt already says what shape is wanted: do not spend context on the schema. */
  omitResponseConstraintInput?: boolean;
}

export interface LanguageModelSession {
  prompt(input: string | LanguageModelMessage[], options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string | LanguageModelMessage[], options?: LanguageModelPromptOptions): ReadableStream<string>;
  destroy(): void;
  /** Tokens of the context window in use. `inputUsage` in Chrome before 148. */
  readonly contextUsage?: number;
  readonly contextWindow?: number;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

export interface LanguageModelExpected {
  type: 'text';
  languages?: string[];
}

export interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelMessage[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  signal?: AbortSignal;
  monitor?(monitor: EventTarget): void;
}

/** `downloadable` and `downloading`: usable after a download that `create()` starts. */
export type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface LanguageModelFactory {
  availability(options?: Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'>): Promise<string>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

/** The browser's `LanguageModel`, or undefined where the Prompt API does not exist. */
export function builtInLanguageModel(): LanguageModelFactory | undefined {
  const candidate = (globalThis as { LanguageModel?: Partial<LanguageModelFactory> }).LanguageModel;
  return candidate && typeof candidate.create === 'function' && typeof candidate.availability === 'function'
    ? (candidate as LanguageModelFactory)
    : undefined;
}

/** What `availability()` and `create()` are told to expect: text in one language both ways. */
export function expectedText(language: string): Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'> {
  return {
    expectedInputs: [{ type: 'text', languages: [language] }],
    expectedOutputs: [{ type: 'text', languages: [language] }],
  };
}

/**
 * Whether the browser has a built-in model for `language` (default English): `unavailable`
 * also when the Prompt API is missing or refuses to say.
 */
export async function languageModelAvailability(
  language = 'en',
  factory: LanguageModelFactory | undefined = builtInLanguageModel(),
): Promise<LanguageModelAvailability> {
  if (!factory) return 'unavailable';
  try {
    const answer = await factory.availability(expectedText(language));
    // Chrome before 138 answered `readily` and `after-download`.
    if (answer === 'available' || answer === 'readily') return 'available';
    if (answer === 'downloadable' || answer === 'after-download') return 'downloadable';
    if (answer === 'downloading') return 'downloading';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Tokens in use and the size of a session's context window, where the browser reports them. */
export function contextOf(session: LanguageModelSession): { used: number; window: number } | undefined {
  const used = session.contextUsage ?? session.inputUsage;
  const window = session.contextWindow ?? session.inputQuota;
  return typeof used === 'number' && typeof window === 'number' && window > 0 ? { used, window } : undefined;
}

/** Read a `promptStreaming()` stream: each chunk is the next piece of text, as Chrome 148 sends it. */
export async function* streamDeltas(stream: ReadableStream<string>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader();
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await abortable(reader.read(), signal);
      if (done) return;
      if (typeof value === 'string' && value) yield value;
    }
  } finally {
    // An abandoned stream keeps the model busy.
    reader.cancel().catch(() => {});
  }
}

/** `promise`, or a rejection as soon as `signal` aborts: a model that ignores the signal must not hold a task. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const stop = () =>
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      // Nobody waits for it any more; its own rejection must not go unhandled.
      promise.catch(() => {});
      return stop();
    }
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}
