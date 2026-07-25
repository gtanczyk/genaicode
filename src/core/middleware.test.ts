import { describe, expect, it, vi } from 'vitest';
import { genaicode } from './client.js';
import { classifyError, isRetryable, withRetry } from './errors.js';
import { cachePlugin, fallbackPlugin, fallbackProvider, rateLimitPlugin, timingPlugin } from './middleware.js';
import { collectStream } from './stream.js';
import type { GenerationRequest, GenerationResult, ModelProvider, StreamEvent } from './types.js';

function sequenceProvider(results: GenerationResult[], streamChunks?: StreamEvent[][]) {
  const requests: GenerationRequest[] = [];
  const provider: ModelProvider = {
    name: 'test',
    capabilities: { streaming: Boolean(streamChunks), tools: true, systemPrompt: true },
    async generate(request) {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error('No test result configured.');
      return result;
    },
    async *stream(request) {
      requests.push(request);
      const chunks = streamChunks?.shift();
      if (chunks) {
        for (const chunk of chunks) yield chunk;
        return;
      }
      const result = results.shift();
      if (!result) throw new Error('No test result configured.');
      yield { type: 'done', result };
    },
  };
  return { provider, requests };
}

describe('streaming', () => {
  it('exposes native stream events from the request builder', async () => {
    const { provider } = sequenceProvider([], [
      [
        { type: 'text-delta', text: 'hel' },
        { type: 'text-delta', text: 'lo' },
        { type: 'done', result: { parts: [{ type: 'text', text: 'hello' }] } },
      ],
    ]);
    const ai = genaicode(provider);
    const events: StreamEvent['type'][] = [];
    let text = '';
    for await (const event of ai('hi').stream()) {
      events.push(event.type);
      if (event.type === 'text-delta') text += event.text;
    }
    expect(text).toBe('hello');
    expect(events).toEqual(['text-delta', 'text-delta', 'done']);
  });

  it('synthesizes a stream when the provider only implements generate', async () => {
    const provider: ModelProvider = {
      name: 'generate-only',
      async generate() {
        return { parts: [{ type: 'text', text: 'snapshot' }] };
      },
    };
    const result = await collectStream(genaicode(provider)('q').stream());
    expect(result.parts).toEqual([{ type: 'text', text: 'snapshot' }]);
  });

  it('updates conversation history after a streamed turn', async () => {
    const { provider } = sequenceProvider([], [
      [{ type: 'text-delta', text: 'one' }, { type: 'done', result: { parts: [{ type: 'text', text: 'one' }] } }],
    ]);
    const chain = genaicode(provider).chain();
    const pieces: string[] = [];
    for await (const delta of chain.streamText('prompt')) {
      pieces.push(delta);
    }
    expect(pieces).toEqual(['one']);
    expect(chain.history()).toEqual([
      { type: 'user', text: 'prompt' },
      { type: 'assistant', text: 'one', images: [], toolCalls: [] },
    ]);
  });
});

describe('middleware plugins', () => {
  it('times generate calls', async () => {
    const timings: number[] = [];
    const { provider } = sequenceProvider([{ parts: [{ type: 'text', text: 'ok' }] }]);
    const ai = genaicode(provider, {
      plugins: [timingPlugin({ onTiming: (info) => timings.push(info.durationMs) })],
    });
    await expect(ai('x').text()).resolves.toBe('ok');
    expect(timings).toHaveLength(1);
    expect(timings[0]).toBeGreaterThanOrEqual(0);
  });

  it('caches identical requests', async () => {
    let calls = 0;
    const provider: ModelProvider = {
      name: 'counting',
      async generate() {
        calls += 1;
        return { parts: [{ type: 'text', text: 'cached-value' }] };
      },
    };
    const ai = genaicode(provider, { plugins: [cachePlugin()] });
    await expect(ai('same').text()).resolves.toBe('cached-value');
    await expect(ai('same').text()).resolves.toBe('cached-value');
    expect(calls).toBe(1);
  });

  it('rate-limits concurrent calls', async () => {
    let active = 0;
    let maxActive = 0;
    const provider: ModelProvider = {
      name: 'slow',
      async generate() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { parts: [{ type: 'text', text: 'ok' }] };
      },
    };
    const ai = genaicode(provider, { plugins: [rateLimitPlugin({ concurrency: 1 })] });
    await Promise.all([ai('a').text(), ai('b').text(), ai('c').text()]);
    expect(maxActive).toBe(1);
  });

  it('falls back to alternate providers', async () => {
    const primary: ModelProvider = {
      name: 'primary',
      async generate() {
        throw Object.assign(new Error('boom'), { status: 500 });
      },
    };
    const secondary: ModelProvider = {
      name: 'secondary',
      async generate() {
        return { parts: [{ type: 'text', text: 'fallback' }] };
      },
    };
    const ai = genaicode(primary, { plugins: [fallbackPlugin({ providers: [secondary] })] });
    await expect(ai('q').text()).resolves.toBe('fallback');
    await expect(
      fallbackProvider([primary, secondary]).generate({ prompt: [{ type: 'user', text: 'q' }] }),
    ).resolves.toMatchObject({
      parts: [{ type: 'text', text: 'fallback' }],
    });
  });
});

describe('retry classification', () => {
  it('classifies transient and permanent errors', () => {
    expect(classifyError(Object.assign(new Error('rate'), { status: 429 })).retryable).toBe(true);
    expect(classifyError(Object.assign(new Error('bad'), { status: 400 })).retryable).toBe(false);
    expect(isRetryable(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true);
  });

  it('retries transient failures with withRetry', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(operation, { attempts: 3, delayMs: 1 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
