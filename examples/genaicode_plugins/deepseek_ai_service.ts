import OpenAI from 'openai';
import {
  FunctionDef,
  PromptItem,
  Plugin,
  ModelType,
  GenerateContentFunction,
  GenerateContentResult,
} from '../../src/index.js';

/**
 * This function generates content using the Deepseek models with the new interface.
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
    };
  },
): Promise<GenerateContentResult> {
  const { getServiceConfig } = await import('../../src/ai-service/service-configurations.js');
  const serviceConfig = getServiceConfig('plugin:deepseek-ai-service');

  const openai = new OpenAI({
    apiKey: serviceConfig.apiKey,
    baseURL: 'https://api.deepseek.com',
  });

  const { internalGenerateContent } = await import('../../src/ai-service/openai.js');
  const { processFunctionCalls } = await import('../../src/ai-service/common.js');

  const modelType = config.modelType ?? ModelType.DEFAULT;
  const functionDefs = config.functionDefs ?? [];
  const requiredFunctionName = config.requiredFunctionName ?? null;

  // Apply Deepseek-specific prompt nudging for requiredFunctionName
  const modifiedPrompt = [...prompt];
  const last = modifiedPrompt.slice(-1)[0];
  const lastText = last?.text;

  if (
    requiredFunctionName &&
    last &&
    last.type === 'user' &&
    last.text &&
    !last.text.includes('IMPORTANT REQUIREMENT')
  ) {
    /* sometimes it is broken :( */
    last.text += `\n\nIMPORTANT REQUIREMENT: Please respond to me with only one function call. The function called must be \`${requiredFunctionName}\`.`;
  }

  try {
    // Determine the model to use based on modelType and service config
    const model =
      modelType === ModelType.CHEAP
        ? (serviceConfig.modelOverrides?.cheap ?? 'deepseek-chat')
        : (serviceConfig.modelOverrides?.default ?? 'deepseek-chat');

    const toolCalls = (
      await internalGenerateContent(modifiedPrompt, config, model, openai, 'plugin:deepseek-ai-service')
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    // Include Deepseek-specific logic to filter multiple identical function calls
    let filteredToolCalls = toolCalls;
    if (requiredFunctionName && toolCalls.length > 1) {
      /* sometimes it is broken :( */
      console.log('Multiple function calls, but all are the same, so keeping only one.');
      filteredToolCalls = toolCalls.filter((call) => call.name === requiredFunctionName).slice(0, 1);
    }

    // Map the result to GenerateContentResult (function call parts)
    const functionCalls = filteredToolCalls.map((call) => {
      const name =
        call.name /* sometimes it is broken :( */
          .match(/\w+/)?.[0] ?? call.name;

      return {
        id: call.id,
        name,
        args: call.args,
      };
    });

    // Process function calls using common.js
    const processedCalls = processFunctionCalls(functionCalls, functionDefs);

    // Return the result as GenerateContentResult
    return processedCalls.map((fc) => ({
      type: 'functionCall',
      functionCall: fc,
    }));
  } finally {
    // Restore original text if it was modified
    if (lastText && last) {
      last.text = lastText;
    }
  }
};

const deepseekAiService: Plugin = {
  name: 'deepseek-ai-service',
  aiServices: {
    'deepseek-ai-service': {
      generateContent,
      serviceConfig: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        openaiBaseUrl: 'https://api.deepseek.com',
        modelOverrides: {
          default: 'deepseek-chat',
          cheap: 'deepseek-chat',
        },
      },
    },
  },
};

export default deepseekAiService;
