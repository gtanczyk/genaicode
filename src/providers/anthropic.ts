import Anthropic from '@anthropic-ai/sdk';
import type { ModelProvider, StreamEvent } from '../core/types.js';
import {
  fromAnthropicMessage,
  toAnthropicRequest,
  type AnthropicRequestDefaults,
} from './anthropic-converter.js';

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
    capabilities: {
      streaming: true,
      tools: true,
      images: 'input',
      systemPrompt: true,
      thinking: true,
    },
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
    async *stream(request): AsyncGenerator<StreamEvent> {
      const model = request.model ?? options.model ?? process.env.ANTHROPIC_MODEL;
      if (!model) {
        throw new Error('No Anthropic model configured. Pass `model` to anthropic() or the request builder.');
      }
      const defaults: AnthropicRequestDefaults = {
        model,
        maxOutputTokens: options.maxOutputTokens,
        thinking: options.thinking,
      };
      const params = toAnthropicRequest(request, defaults);
      const stream = client.messages.stream({ ...params }, { signal: request.signal });

      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolCalls.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: '',
          });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text-delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const current = toolCalls.get(event.index);
            if (current) {
              current.arguments += event.delta.partial_json;
              yield {
                type: 'tool-call-delta',
                id: current.id,
                name: current.name,
                argumentsDelta: event.delta.partial_json,
              };
            }
          }
        } else if (event.type === 'message_delta' && event.usage) {
          // message_delta only reports output tokens; omit total until finalMessage.
          yield {
            type: 'usage',
            usage: {
              outputTokens: event.usage.output_tokens,
            },
          };
        }
      }

      const result = fromAnthropicMessage(await stream.finalMessage());
      for (const part of result.parts) {
        if (part.type === 'toolCall') {
          yield { type: 'tool-call', toolCall: part.toolCall };
        }
      }
      yield { type: 'done', result };
    },
  };
}
