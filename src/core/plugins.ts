import type { GenerationRequest, GenerationResult, ModelProvider } from './types.js';

export type GenerateNext = (request?: GenerationRequest) => Promise<GenerationResult>;

export interface GenAIPlugin {
  readonly name: string;
  generate(request: GenerationRequest, next: GenerateNext): Promise<GenerationResult>;
}

export function definePlugin(plugin: GenAIPlugin): GenAIPlugin {
  return plugin;
}

/**
 * Wrap a provider with middleware-style plugins.
 *
 * Plugins run in registration order. Each plugin may modify the request passed
 * to `next`, transform its result, handle an error, or intentionally short-circuit.
 */
export function withPlugins(provider: ModelProvider, plugins: readonly GenAIPlugin[]): ModelProvider {
  if (plugins.length === 0) return provider;

  return {
    name: provider.name,
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
  };
}
