import { generateAsStream, providerStream } from './stream.js';
import type { GenerationRequest, GenerationResult, ModelProvider, StreamEvent } from './types.js';

export type GenerateNext = (request?: GenerationRequest) => Promise<GenerationResult>;
export type StreamNext = (request?: GenerationRequest) => AsyncIterable<StreamEvent>;

export interface GenAIPlugin {
  readonly name: string;
  generate(request: GenerationRequest, next: GenerateNext): Promise<GenerationResult>;
  /**
   * Optional streaming middleware. When omitted, the stream path passes through
   * to the next plugin / provider unchanged.
   */
  stream?(request: GenerationRequest, next: StreamNext): AsyncIterable<StreamEvent>;
}

export function definePlugin(plugin: GenAIPlugin): GenAIPlugin {
  return plugin;
}

/**
 * Wrap a provider with middleware-style plugins.
 *
 * Plugins run in registration order. Each plugin may modify the request passed
 * to `next`, transform its result, handle an error, or intentionally short-circuit.
 * Streaming uses the same order; plugins without `stream` pass through.
 */
export function withPlugins(provider: ModelProvider, plugins: readonly GenAIPlugin[]): ModelProvider {
  if (plugins.length === 0) return provider;

  const wrapped: ModelProvider = {
    name: provider.name,
    capabilities: provider.capabilities,
    generate(request) {
      let lastIndex = -1;
      const dispatch = (index: number, currentRequest: GenerationRequest): Promise<GenerationResult> => {
        if (index <= lastIndex) {
          return Promise.reject(new Error('A GenAIcode plugin called next() more than once.'));
        }
        lastIndex = index;
        const plugin = plugins[index];
        if (!plugin) return provider.generate(currentRequest);
        return plugin.generate(currentRequest, (nextRequest = currentRequest) => dispatch(index + 1, nextRequest));
      };
      return dispatch(0, request);
    },
    stream(request) {
      let lastIndex = -1;
      const dispatch = (index: number, currentRequest: GenerationRequest): AsyncIterable<StreamEvent> => {
        if (index <= lastIndex) {
          throw new Error('A GenAIcode plugin called next() more than once.');
        }
        lastIndex = index;
        const plugin = plugins[index];
        if (!plugin) {
          return provider.stream
            ? providerStream(provider, currentRequest)
            : generateAsStream((nextRequest) => provider.generate(nextRequest), currentRequest);
        }
        if (plugin.stream) {
          return plugin.stream(currentRequest, (nextRequest = currentRequest) => dispatch(index + 1, nextRequest));
        }
        return dispatch(index + 1, currentRequest);
      };
      return dispatch(0, request);
    },
  };

  return wrapped;
}
