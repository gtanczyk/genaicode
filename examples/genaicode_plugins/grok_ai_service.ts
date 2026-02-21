import OpenAI from 'openai';
import {
  FunctionDef,
  PromptItem,
  Plugin,
  GenerateContentFunction,
  ModelType,
  GenerateContentResult,
} from '../../src/index.js';

/**
 * This function generates content using the Grok models with the new interface.
 */
const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  config: {
    modelType?: ModelType;
    temperature?: number;
    functionDefs?: FunctionDef[];
    requiredFunctionName?: string | null;
    expectedResponseType?: {
      text?: boolean;
      functionCall?: boolean;
      media?: boolean;
      codeExecution?: boolean;
    };
  },
): Promise<GenerateContentResult> {
  const { getServiceConfig } = await import('../../src/ai-service/service-configurations.js');
  const serviceConfig = getServiceConfig('plugin:grok-ai-service');

  const openai = new OpenAI({
    apiKey: serviceConfig.apiKey,
    baseURL: 'https://api.x.ai/v1',
  });

  const { internalGenerateContent } = await import('../../src/ai-service/openai.js');

  const modelType = config.modelType ?? ModelType.DEFAULT;

  // Determine the model to use based on modelType and service config
  const model =
    modelType === ModelType.CHEAP
      ? (serviceConfig.modelOverrides?.cheap ?? 'grok-3-mini-beta')
      : modelType === ModelType.REASONING
        ? (serviceConfig.modelOverrides?.reasoning ?? 'grok-3-mini-beta')
        : (serviceConfig.modelOverrides?.default ?? 'grok-4');

  // Call internalGenerateContent from openai.ts with the new signature
  return await internalGenerateContent(
    prompt.map((item) => ({ ...item, text: item.text ?? ' ' })),
    config,
    model,
    openai,
    'plugin:grok-ai-service', // Pass the plugin serviceType for proper model settings lookup
  );
};

const grokAiService: Plugin = {
  name: 'grok-ai-service',
  aiServices: {
    'grok-ai-service': {
      generateContent,
      serviceConfig: {
        apiKey: process.env.GROK_OPENAI_API_KEY,
        modelOverrides: {
          default: 'grok-4',
          cheap: 'grok-3-mini-beta',
          reasoning: 'grok-3-mini-beta',
        },
      },
    },
  },
};

export default grokAiService;
