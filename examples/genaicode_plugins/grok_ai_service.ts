import OpenAI from 'openai';
import {
  FunctionCall,
  FunctionDef,
  PromptItem,
  Plugin,
  GenerateContentFunction,
  ModelType,
  GenerateContentNewFunction,
  GenerateContentResult,
  GenerateContentArgsNew,
} from '../../src/index.js';

/**
 * This function generates content using the Grok models with the new interface.
 */
const generateContentNew: GenerateContentNewFunction = async function generateContentNew(
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
    { ...options, aiService: 'plugin:grok-ai-service' },
    model,
    openai,
  );
};

/**
 * This function generates content using the Grok models.
 * It uses the new generateContentNew function internally.
 */
const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
): Promise<FunctionCall[]> {
  // Call the new function with mapped parameters
  const result = await generateContentNew(
    prompt,
    {
      modelType,
      temperature,
      functionDefs,
      requiredFunctionName,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    {
      aiService: 'plugin:grok-ai-service',
    },
  );

  // Extract only the function calls from the result
  return result
    .filter((part): part is { type: 'functionCall'; functionCall: FunctionCall } => part.type === 'functionCall')
    .map((part) => part.functionCall);
};

const grokAiService: Plugin = {
  name: 'grok-ai-service',
  aiServices: {
    'grok-ai-service': {
      generateContent,
      generateContentNew,
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
