import OpenAI from 'openai';
import { FunctionCall, FunctionDef, PromptItem, Plugin, GenerateContentFunction, ModelType } from '../../src/index.js';

const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
): Promise<FunctionCall[]> {
  const { getServiceConfig } = await import('../../src/ai-service/service-configurations.js');
  const serviceConfig = getServiceConfig('plugin:grok-ai-service');

  const openai = new OpenAI({
    apiKey: serviceConfig.apiKey,
    baseURL: 'https://api.x.ai/v1',
  });

  const { internalGenerateContent } = await import('../../src/ai-service/openai.js');

  return internalGenerateContent(
    prompt,
    functionDefs,
    requiredFunctionName,
    temperature,
    modelType,
    modelType === ModelType.CHEAP
      ? (serviceConfig.modelOverrides?.cheap ?? 'grok-beta')
      : (serviceConfig.modelOverrides?.default ?? 'grok-beta'),
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
