import type {
  LanguageModelCreateOptions,
  LanguageModelFactory,
  LanguageModelMessage,
  LanguageModelPromptOptions,
  LanguageModelSession,
} from './language-model.js';

export interface FakeCall {
  input: string;
  options?: LanguageModelPromptOptions;
  streaming: boolean;
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
  options: { availability?: string; download?: number[]; window?: number; keeps?: number } = {},
) {
  const calls: FakeCall[] = [];
  const created: LanguageModelCreateOptions[] = [];
  let destroyed = 0;
  let at = 0;
  const next = async (input: string | LanguageModelMessage[], promptOptions?: LanguageModelPromptOptions) => {
    const text = typeof input === 'string' ? input : input.map((message) => message.content).join('\n');
    promptOptions?.signal?.throwIfAborted();
    const reply = script[Math.min(at++, script.length - 1)];
    if (reply === undefined) throw new Error('fakeLanguageModel: nothing scripted');
    return typeof reply === 'function' ? reply(text, promptOptions) : reply;
  };
  const factory: LanguageModelFactory = {
    availability: async () => options.availability ?? 'available',
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
      const session: LanguageModelSession = {
        async prompt(input, promptOptions) {
          calls.push({ input: String(input), options: promptOptions, streaming: false });
          const reply = await next(input, promptOptions);
          grow();
          return reply;
        },
        promptStreaming(input, promptOptions) {
          calls.push({ input: String(input), options: promptOptions, streaming: true });
          return new ReadableStream<string>({
            async start(controller) {
              try {
                const reply = await next(input, promptOptions);
                grow();
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
        destroy() {
          destroyed++;
        },
        get contextUsage() {
          return used;
        },
        contextWindow: options.window ?? 1000,
      };
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
  };
}
