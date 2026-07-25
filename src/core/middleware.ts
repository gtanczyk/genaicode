import type { GenerationRequest, GenerationResult, ModelProvider } from './types.js';
import { definePlugin, type GenAIPlugin } from './plugins.js';
import { providerStream } from './stream.js';

export interface TimingPluginOptions {
  onTiming?: (info: { plugin: string; provider?: string; durationMs: number; ok: boolean }) => void;
}

/** Observability middleware: records wall-clock duration around each generate call. */
export function timingPlugin(options: TimingPluginOptions = {}): GenAIPlugin {
  const onTiming =
    options.onTiming ??
    ((info) => {
      console.log(`[genaicode] ${info.plugin} ${info.ok ? 'ok' : 'error'} in ${info.durationMs.toFixed(1)}ms`);
    });

  return definePlugin({
    name: 'timing',
    async generate(request, next) {
      const startedAt = performance.now();
      try {
        const result = await next(request);
        onTiming({ plugin: 'timing', durationMs: performance.now() - startedAt, ok: true });
        return result;
      } catch (error) {
        onTiming({ plugin: 'timing', durationMs: performance.now() - startedAt, ok: false });
        throw error;
      }
    },
  });
}

export interface RateLimitPluginOptions {
  /** Maximum concurrent in-flight generate calls. Defaults to 1. */
  concurrency?: number;
  /** Minimum delay between starting successive calls, in milliseconds. */
  minIntervalMs?: number;
}

/** Simple concurrency / interval limiter. Does not talk to external rate-limit stores. */
export function rateLimitPlugin(options: RateLimitPluginOptions = {}): GenAIPlugin {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  let active = 0;
  let lastStartedAt = 0;
  const waiters: Array<() => void> = [];

  const pump = () => {
    while (active < concurrency && waiters.length > 0) {
      const now = Date.now();
      const waitMs = Math.max(0, minIntervalMs - (now - lastStartedAt));
      if (waitMs > 0 && active > 0) {
        setTimeout(pump, waitMs);
        return;
      }
      const next = waiters.shift();
      if (!next) return;
      active += 1;
      lastStartedAt = Date.now();
      next();
    }
  };

  const acquire = () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      pump();
    });

  const release = () => {
    active = Math.max(0, active - 1);
    pump();
  };

  return definePlugin({
    name: 'rate-limit',
    async generate(request, next) {
      await acquire();
      try {
        return await next(request);
      } finally {
        release();
      }
    },
  });
}

export interface CachePluginOptions {
  /** Stable cache key. Defaults to a JSON serialization of the request (excluding signal). */
  key?: (request: GenerationRequest) => string;
  maxEntries?: number;
}

function defaultCacheKey(request: GenerationRequest): string {
  return JSON.stringify({
    prompt: request.prompt,
    model: request.model,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    tools: request.tools,
    toolChoice: request.toolChoice,
    metadata: request.metadata,
  });
}

/** In-memory response cache. Intentionally short-circuits `next` on hit. */
export function cachePlugin(options: CachePluginOptions = {}): GenAIPlugin {
  const keyOf = options.key ?? defaultCacheKey;
  const maxEntries = options.maxEntries ?? 128;
  const cache = new Map<string, GenerationResult>();

  return definePlugin({
    name: 'cache',
    async generate(request, next) {
      const key = keyOf(request);
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const result = await next(request);
      cache.set(key, result);
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return result;
    },
  });
}

export interface FallbackPluginOptions {
  /** Additional providers tried after the primary provider fails. */
  providers: readonly ModelProvider[];
  /** Decide whether an error should trigger fallback. Defaults to always. */
  shouldFallback?: (error: unknown, attempt: number) => boolean;
}

/**
 * Fallback middleware: on primary failure, try alternate providers in order.
 * Each alternate receives the same GenerationRequest.
 */
export function fallbackPlugin(options: FallbackPluginOptions): GenAIPlugin {
  const shouldFallback = options.shouldFallback ?? (() => true);

  return definePlugin({
    name: 'fallback',
    async generate(request, next) {
      try {
        return await next(request);
      } catch (error) {
        if (!shouldFallback(error, 0)) throw error;
        let lastError: unknown = error;
        for (let index = 0; index < options.providers.length; index += 1) {
          if (!shouldFallback(lastError, index + 1) && index > 0) throw lastError;
          try {
            return await options.providers[index].generate(request);
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
        throw lastError;
      }
    },
  });
}

/**
 * Compose multiple providers into one ModelProvider that tries each until one succeeds.
 * Prefer this when there is no single "primary" provider wired through plugins.
 */
export function fallbackProvider(providers: readonly ModelProvider[], name = 'fallback'): ModelProvider {
  if (providers.length === 0) {
    throw new Error('fallbackProvider requires at least one provider.');
  }
  const [primary] = providers;
  return {
    name,
    capabilities: {
      streaming: providers.every((provider) => provider.capabilities?.streaming || Boolean(provider.stream)),
      tools: providers.every((provider) => provider.capabilities?.tools !== false),
      systemPrompt: providers.every((provider) => provider.capabilities?.systemPrompt !== false),
    },
    async generate(request) {
      let lastError: unknown;
      for (const provider of providers) {
        try {
          return await provider.generate(request);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    stream(request) {
      // Stream from the first provider that exposes streaming; otherwise synthesize.
      return providerStream(primary, request);
    },
  };
}
