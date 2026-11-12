import type {
  LanguageModelContent,
  LanguageModelCreateOptions,
  LanguageModelFactory,
  LanguageModelMedia,
  LanguageModelMessage,
  LanguageModelPromptOptions,
  LanguageModelSession,
} from './language-model.js';

export interface FakeCall {
  /** The prompt's text; an image or audio part shows as `[image]` or `[audio]`. */
  input: string;
  /** The image and audio parts sent with the prompt. */
  media: LanguageModelContent[];
  options?: LanguageModelPromptOptions;
  streaming: boolean;
  /** Whether the prompt went to a copy of the session (`clone()`) rather than the session itself. */
  copy: boolean;
}

/** A scripted reply, or a function of the prompt. */
export type FakeReply = string | ((input: string, options?: LanguageModelPromptOptions) => string | Promise<string>);

/**
 * A stand-in for the browser's `LanguageModel` in tests: replies come from `script` in order
 * (the last one repeats), and every prompt is recorded in `calls`. Each prompt adds 10 tokens to
 * the context in use, up to `keeps` (default: no limit), the way a full window drops old messages.
 */
export function fakeLanguageModel(
  script: FakeReply[],
  options: {
    availability?: string;
    download?: number[];
    window?: number;
    keeps?: number;
    /** What the model takes besides text. Default: nothing. */
    media?: readonly LanguageModelMedia[];
    /** Sessions have no `clone()`, as in the first browsers with the API. */
    noClone?: boolean;
    /**
     * Behave as Chrome does: a session keeps the first `responseConstraint` it was given, and a
     * prompt with another one fails with `UnknownError`.
     */
    stickyConstraint?: boolean;
  } = {},
) {
  const calls: FakeCall[] = [];
  const created: LanguageModelCreateOptions[] = [];
  let destroyed = 0;
  let copies = 0;
  let released = 0;
  let at = 0;
  const next = async (input: string | LanguageModelMessage[], promptOptions?: LanguageModelPromptOptions) => {
    const text = textOf(input);
    promptOptions?.signal?.throwIfAborted();
    const reply = script[Math.min(at++, script.length - 1)];
    if (reply === undefined) throw new Error('fakeLanguageModel: nothing scripted');
    return typeof reply === 'function' ? reply(text, promptOptions) : reply;
  };
  const factory: LanguageModelFactory = {
    availability: async (asked) =>
      (asked?.expectedInputs ?? []).some((input) => input.type !== 'text' && !options.media?.includes(input.type))
        ? 'unavailable'
        : (options.availability ?? 'available'),
    async create(createOptions = {}) {
      created.push(createOptions);
      if (options.download) {
        const target = new EventTarget();
        createOptions.monitor?.(target);
        for (const loaded of options.download) {
          target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
        }
      }
      let used = 0;
      const grow = () => {
        used = Math.min(used + 10, options.keeps ?? Infinity);
      };
      const make = (copy: boolean, held?: string): LanguageModelSession => {
        let constraint = held;
        const record = (
          input: string | LanguageModelMessage[],
          promptOptions: LanguageModelPromptOptions | undefined,
          streaming: boolean,
        ) => {
          calls.push({ input: textOf(input), media: mediaOf(input), options: promptOptions, streaming, copy });
        };
        const answer = async (input: string | LanguageModelMessage[], promptOptions?: LanguageModelPromptOptions) => {
          const asked = promptOptions?.responseConstraint && JSON.stringify(promptOptions.responseConstraint);
          if (options.stickyConstraint && asked) {
            if (constraint !== undefined && constraint !== asked) {
              throw new DOMException('An unknown error occurred: kErrorUnknown', 'UnknownError');
            }
            constraint = asked;
          }
          const reply = await next(input, promptOptions);
          grow();
          return reply;
        };
        return {
          async prompt(input, promptOptions) {
            record(input, promptOptions, false);
            return answer(input, promptOptions);
          },
          promptStreaming(input, promptOptions) {
            record(input, promptOptions, true);
            return new ReadableStream<string>({
              async start(controller) {
                try {
                  const reply = await answer(input, promptOptions);
                  // Two chunks, so deltas are joined.
                  const half = Math.ceil(reply.length / 2);
                  controller.enqueue(reply.slice(0, half));
                  if (reply.length > half) controller.enqueue(reply.slice(half));
                  controller.close();
                } catch (error) {
                  controller.error(error);
                }
              },
            });
          },
          ...(options.noClone
            ? {}
            : {
                async clone() {
                  copies++;
                  return make(true, constraint);
                },
              }),
          destroy() {
            if (copy) released++;
            else destroyed++;
          },
          get contextUsage() {
            return used;
          },
          contextWindow: options.window ?? 1000,
        };
      };
      const session = make(false);
      return session;
    },
  };
  return {
    factory,
    calls,
    created,
    get destroyed() {
      return destroyed;
    },
    /** Copies made with `clone()`, and how many of them were destroyed. */
    get copies() {
      return copies;
    },
    get released() {
      return released;
    },
  };
}

function parts(input: string | LanguageModelMessage[]): LanguageModelContent[] {
  if (typeof input === 'string') return [{ type: 'text', value: input }];
  return input.flatMap((message) =>
    typeof message.content === 'string' ? [{ type: 'text' as const, value: message.content }] : message.content,
  );
}

function textOf(input: string | LanguageModelMessage[]): string {
  return parts(input)
    .map((part) => (part.type === 'text' ? String(part.value) : `[${part.type}]`))
    .join('\n');
}

function mediaOf(input: string | LanguageModelMessage[]): LanguageModelContent[] {
  return parts(input).filter((part) => part.type !== 'text');
}
