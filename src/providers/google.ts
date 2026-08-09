import { GoogleGenAI, type GenerateContentConfig, type GoogleGenAIOptions } from '@google/genai';
import type { ModelProvider, StreamEvent } from '../core/types.js';
import { fromGoogleResponse, toGoogleRequest, type GoogleRequestDefaults } from './google-converter.js';

// 'tools' stays available for built-in tools like Google Search grounding — see
// GoogleRequestDefaults in google-converter.ts.
type GoogleGenerationDefaults = Omit<
  GenerateContentConfig,
  'abortSignal' | 'systemInstruction' | 'temperature' | 'maxOutputTokens' | 'toolConfig'
>;

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  apiVersion?: string;
  httpOptions?: GoogleGenAIOptions['httpOptions'];
  generationConfig?: GoogleGenerationDefaults;
}

export interface VertexAIProviderOptions {
  project?: string;
  location?: string;
  model?: string;
  apiVersion?: string;
  googleAuthOptions?: GoogleGenAIOptions['googleAuthOptions'];
  httpOptions?: GoogleGenAIOptions['httpOptions'];
  generationConfig?: GoogleGenerationDefaults;
}

function googleProvider(
  name: 'gemini' | 'vertex-ai',
  clientOptions: GoogleGenAIOptions,
  model: string | undefined,
  generationConfig: GoogleGenerationDefaults | undefined,
): ModelProvider {
  const client = new GoogleGenAI(clientOptions);
  return {
    name,
    capabilities: {
      streaming: true,
      tools: true,
      images: 'both',
      systemPrompt: true,
      jsonResponse: true,
      thinking: true,
    },
    async generate(request) {
      const selectedModel = request.model ?? model;
      if (!selectedModel) {
        throw new Error(`No ${name} model configured. Pass a model to the provider or the request builder.`);
      }
      const defaults: GoogleRequestDefaults = { model: selectedModel, config: generationConfig };
      const response = await client.models.generateContent(toGoogleRequest(request, defaults));
      return fromGoogleResponse(response);
    },
    async *stream(request): AsyncGenerator<StreamEvent> {
      const selectedModel = request.model ?? model;
      if (!selectedModel) {
        throw new Error(`No ${name} model configured. Pass a model to the provider or the request builder.`);
      }
      const defaults: GoogleRequestDefaults = { model: selectedModel, config: generationConfig };
      const googleRequest = toGoogleRequest(request, defaults);
      const stream = await client.models.generateContentStream({
        ...googleRequest,
        config: {
          ...googleRequest.config,
          abortSignal: request.signal,
        },
      });

      let text = '';
      let lastResponse: Parameters<typeof fromGoogleResponse>[0] | undefined;

      for await (const chunk of stream) {
        lastResponse = chunk;
        const piece = chunk.text ?? '';
        if (piece) {
          // Google SDK `text` is cumulative per stream chunk in some versions; prefer delta when possible.
          const delta = piece.startsWith(text) ? piece.slice(text.length) : piece;
          if (delta) {
            text += delta;
            yield { type: 'text-delta', text: delta };
          }
        }
      }

      if (!lastResponse) {
        yield { type: 'done', result: { parts: text ? [{ type: 'text', text }] : [] } };
        return;
      }

      const result = fromGoogleResponse(lastResponse);
      // If the final chunk only had partial text, prefer accumulated streamed text when present.
      if (text && result.parts.every((part) => part.type !== 'text')) {
        result.parts = [{ type: 'text', text }, ...result.parts];
      } else if (text) {
        const textPart = result.parts.find((part) => part.type === 'text');
        if (textPart && textPart.type === 'text' && textPart.text.length < text.length) {
          textPart.text = text;
        }
      }

      for (const part of result.parts) {
        if (part.type === 'toolCall') {
          yield { type: 'tool-call', toolCall: part.toolCall };
        } else if (part.type === 'image') {
          yield { type: 'image', image: part.image };
        }
      }
      if (result.usage) {
        yield { type: 'usage', usage: result.usage };
      }
      yield { type: 'done', result };
    },
  };
}

export function gemini(options: GeminiProviderOptions = {}): ModelProvider {
  return googleProvider(
    'gemini',
    {
      apiKey: options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.API_KEY,
      apiVersion: options.apiVersion,
      httpOptions: options.httpOptions,
    },
    options.model ?? process.env.GEMINI_MODEL,
    options.generationConfig,
  );
}

export function vertexAI(options: VertexAIProviderOptions = {}): ModelProvider {
  return googleProvider(
    'vertex-ai',
    {
      vertexai: true,
      project: options.project ?? process.env.GOOGLE_CLOUD_PROJECT,
      location: options.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? process.env.GOOGLE_CLOUD_REGION ?? 'global',
      apiVersion: options.apiVersion,
      googleAuthOptions: options.googleAuthOptions,
      httpOptions: options.httpOptions,
    },
    options.model ?? process.env.VERTEX_AI_MODEL ?? process.env.GEMINI_MODEL,
    options.generationConfig,
  );
}
