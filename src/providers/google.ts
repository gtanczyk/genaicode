import { GoogleGenAI, type GenerateContentConfig, type GoogleGenAIOptions } from '@google/genai';
import type { ModelProvider } from '../core/types.js';
import { fromGoogleResponse, toGoogleRequest, type GoogleRequestDefaults } from './google-converter.js';

type GoogleGenerationDefaults = Omit<
  GenerateContentConfig,
  'abortSignal' | 'systemInstruction' | 'temperature' | 'maxOutputTokens' | 'tools' | 'toolConfig'
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
    async generate(request) {
      const selectedModel = request.model ?? model;
      if (!selectedModel) {
        throw new Error(`No ${name} model configured. Pass a model to the provider or the request builder.`);
      }
      const defaults: GoogleRequestDefaults = { model: selectedModel, config: generationConfig };
      const response = await client.models.generateContent(toGoogleRequest(request, defaults));
      return fromGoogleResponse(response);
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
