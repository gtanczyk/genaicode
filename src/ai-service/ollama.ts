import OpenAI from 'openai';
import assert from 'node:assert';
import { GenerateContentFunction } from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { ModelType } from './common-types.js';
import { getServiceConfig } from './service-configurations.js';
import { internalGenerateContent } from './openai.js';

/**
 * This function generates content using the Ollama service.
 * Ollama provides an OpenAI-compatible API, so we can reuse the OpenAI implementation.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
): Promise<FunctionCall[]> {
  try {
    const serviceConfig = getServiceConfig('ollama');

    // Ollama requires an API key in the OpenAI client, but doesn't actually use it
    // We set a dummy value and use the baseURL to connect to Ollama
    const apiKey = serviceConfig?.apiKey || 'ollama';
    const baseURL = serviceConfig?.openaiBaseUrl || 'http://localhost:11434/v1/';

    assert(baseURL, 'Ollama base URL not configured, use OLLAMA_BASE_URL environment variable.');

    const openai = new OpenAI({
      apiKey,
      baseURL,
    });

    const model = (() => {
      switch (modelType) {
        case ModelType.CHEAP:
          return serviceConfig.modelOverrides?.cheap ?? 'gemma3:12b';
        case ModelType.REASONING:
          return serviceConfig.modelOverrides?.reasoning ?? 'gemma3:12b';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gemma3:12b';
      }
    })();

    console.log(`Using Ollama model: ${model}`);

    // additional nudge to the model to call the required function
    if (requiredFunctionName) {
      prompt.push({
        type: 'user',
        text: `Call the \`${requiredFunctionName}\` function`,
      });
    }

    return internalGenerateContent(
      prompt.map((item) => ({ ...item, text: item.text ?? ' ' })),
      functionDefs,
      requiredFunctionName,
      temperature,
      modelType,
      model,
      openai,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('base URL not configured')) {
      throw new Error('Ollama base URL not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
