import OpenAI from 'openai';
import assert from 'node:assert';
import {
  FunctionDef,
  GenerateContentArgs,
  GenerateContentFunction,
  GenerateContentResult,
  PromptItem,
} from './common-types.js';
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
        case ModelType.REASONING:
          return serviceConfig.modelOverrides?.reasoning ?? 'o1-mini';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gpt-4o';
      }
    })();

    if (config.functionDefs) {
      // GH Models input token limit is very low (8k), so we need to cut something from the context
      config.functionDefs = optimizeFunctionDefs(prompt, config.functionDefs, config.requiredFunctionName ?? undefined);
    }

    // Reuse OpenAI implementation since GitHub Models uses the same API format
    return internalGenerateContent(prompt, config, model, openai, 'github-models');
  } catch (error) {
    if (error instanceof Error && error.message.includes('API token not configured')) {
      throw new Error('GitHub Models API token not configured. Please set up the service configuration.');
    }
    throw error;
  }
};

function optimizeFunctionDefs(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | undefined,
): FunctionDef[] {
  const promptFunctionNames = new Set(
    prompt.map((item) => item.functionCalls).flatMap((fcs) => fcs?.map((fc) => fc.name)),
  );
  return functionDefs.filter(
    (def) => promptFunctionNames.has(def.name) || !requiredFunctionName || def.name === requiredFunctionName,
  );
}
