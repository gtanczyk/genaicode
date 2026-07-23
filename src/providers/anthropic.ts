import Anthropic from '@anthropic-ai/sdk';
import type { ModelProvider } from '../core/types.js';
import { fromAnthropicMessage, toAnthropicRequest, type AnthropicRequestDefaults } from './anthropic-converter.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxOutputTokens?: number;
  thinking?: Anthropic.ThinkingConfigParam;
  defaultHeaders?: Record<string, string>;
}

export function anthropic(options: AnthropicProviderOptions = {}): ModelProvider {
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: options.baseURL,
    defaultHeaders: options.defaultHeaders,
  });

  return {
    name: 'anthropic',
    async generate(request) {
      const model = request.model ?? options.model ?? process.env.ANTHROPIC_MODEL;
      if (!model) {
        throw new Error('No Anthropic model configured. Pass `model` to anthropic() or the request builder.');
      }
      const defaults: AnthropicRequestDefaults = {
        model,
        maxOutputTokens: options.maxOutputTokens,
        thinking: options.thinking,
      };
      const message = await client.messages.create(toAnthropicRequest(request, defaults), {
        signal: request.signal,
      });
      return fromAnthropicMessage(message);
    },
  };
}
