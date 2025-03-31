import OpenAI from 'openai';
import {
  FunctionCall,
  FunctionDef,
  PromptItem,
  Plugin,
  GenerateContentFunction,
  ModelType,
  GenerateContentResult,
  GenerateContentArgs,
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
      text: boolean;
      functionCall: boolean;
      media: boolean;
    };
  },
  options: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  } = {},
): Promise<GenerateContentResult> {
  const { getServiceConfig } = await import('../../src/ai-service/service-configurations.js');
  const serviceConfig = getServiceConfig('plugin:grok-ai-service');

  const openai = new OpenAI({
    apiKey: serviceConfig.apiKey,
    baseURL: 'https://api.x.ai/v1',
  });

  const { internalGenerateContent } = await import('../../src/ai-service/openai.js');

  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7;
  const functionDefs = config.functionDefs ?? [];
  const requiredFunctionName = config.requiredFunctionName ?? null;

  // Determine the model to use based on modelType and service config
  const model =
    modelType === ModelType.CHEAP
      ? (serviceConfig.modelOverrides?.cheap ?? 'grok-beta')
      : (serviceConfig.modelOverrides?.default ?? 'grok-beta');

  // Call internalGenerateContent from openai.ts with the new signature
  return await internalGenerateContent(
    prompt.map((item) => ({ ...item, text: item.text ?? ' ' })),
    config,
    model,
    openai,
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
          default: 'grok-beta',
          cheap: 'grok-beta',
        },
      },
    },
  },
};

export default grokAiService;
