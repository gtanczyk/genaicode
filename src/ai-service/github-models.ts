import OpenAI from 'openai';
import assert from 'node:assert';
import { GenerateContentArgs, GenerateContentFunction, GenerateContentResult } from './common-types.js';
import { ModelType } from './common-types.js';
import { getServiceConfig } from './service-configurations.js';
import { internalGenerateContent } from './openai.js';

/**
 * GitHub Models service implementation using OpenAI-compatible API
 *
 * GitHub Models provides access to various AI models through a unified API
 * that is compatible with OpenAI's interface.
 *
 * Authentication: Uses GitHub Personal Access Token
 * Base URL: https://models.inference.ai.azure.com
 *
 * @see https://github.blog/ai-and-ml/llms/solving-the-inference-problem-for-open-source-ai-projects-with-github-models/
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  const [prompt, config] = args;
  try {
    const serviceConfig = getServiceConfig('github-models');
    assert(
      serviceConfig?.apiKey,
      'GitHub Models API token not configured. Use GITHUB_TOKEN environment variable with a Personal Access Token.',
    );

    // Create OpenAI client configured for GitHub Models
    const openai = new OpenAI({
      apiKey: serviceConfig.apiKey,
      baseURL: 'https://models.inference.ai.azure.com',
    });

    const modelType = config.modelType ?? ModelType.DEFAULT;
    const model = (() => {
      switch (modelType) {
        case ModelType.CHEAP:
          return serviceConfig.modelOverrides?.cheap ?? 'gpt-4o-mini';
        case ModelType.LITE:
          return serviceConfig.modelOverrides?.lite ?? 'gpt-4o-mini';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gpt-4o';
      }
    })();

    console.log('Using github-models');

    // Reuse OpenAI implementation since GitHub Models uses the same API format
    return internalGenerateContent(prompt, config, model, openai, 'github-models');
  } catch (error) {
    if (error instanceof Error && error.message.includes('API token not configured')) {
      throw new Error('GitHub Models API token not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
