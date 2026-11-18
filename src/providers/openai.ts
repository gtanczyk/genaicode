import OpenAI from 'openai';
import type { ModelProvider } from '../core/types.js';
import { fromOpenAICompletion, fromOpenAIStream, toOpenAIRequest, toOpenAIStreamRequest } from './openai-converter.js';
import {
  fromOpenAIResponse,
  fromOpenAIResponsesStream,
  toOpenAIResponsesRequest,
  toOpenAIResponsesStreamRequest,
} from './openai-responses-converter.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  organization?: string;
  project?: string;
  /**
   * Which OpenAI API carries the requests. Default `responses` for `openai()`: GPT-6 models take
   * function tools only there. `chat` uses chat completions (`openaiCompatible()` always does).
   */
  api?: 'responses' | 'chat';
}

export function openai(options: OpenAIProviderOptions = {}): ModelProvider {
  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    baseURL: options.baseURL,
    organization: options.organization,
    project: options.project,
  });
  const defaultModel = options.model ?? process.env.OPENAI_MODEL;
  const useResponses = (options.api ?? 'responses') === 'responses';

  return {
    name: 'openai',
    capabilities: {
      streaming: true,
      tools: true,
      images: 'input',
      systemPrompt: true,
      jsonResponse: true,
    },
    async generate(request) {
      const model = request.model ?? defaultModel;
      if (!model) {
        throw new Error('No OpenAI model configured. Pass `model` to openai() or the request builder.');
      }
      if (useResponses) {
        const response = await client.responses.create(toOpenAIResponsesRequest(request, model), {
          signal: request.signal,
        });
        return fromOpenAIResponse(response);
      }
      const completion = await client.chat.completions.create(toOpenAIRequest(request, model), {
        signal: request.signal,
      });
      return fromOpenAICompletion(completion);
    },
    async *stream(request) {
      const model = request.model ?? defaultModel;
      if (!model) {
        throw new Error('No OpenAI model configured. Pass `model` to openai() or the request builder.');
      }
      if (useResponses) {
        const events = await client.responses.create(toOpenAIResponsesStreamRequest(request, model), {
          signal: request.signal,
        });
        yield* fromOpenAIResponsesStream(events);
        return;
      }
      const chunks = await client.chat.completions.create(toOpenAIStreamRequest(request, model), {
        signal: request.signal,
      });
      yield* fromOpenAIStream(chunks);
    },
  };
}

export interface OpenAICompatibleProviderOptions extends Omit<OpenAIProviderOptions, 'api'> {
  name?: string;
}

export function openaiCompatible(options: OpenAICompatibleProviderOptions): ModelProvider {
  const provider = openai({ ...options, api: 'chat' });
  return { ...provider, name: options.name ?? 'openai-compatible' };
}
