import OpenAI from 'openai';
import { FunctionCall, FunctionDef, PromptItem, Plugin } from '../../src/index.js';

const grokAiService: Plugin = {
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

async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
): Promise<FunctionCall[]> {
  const { getServiceConfig } = await import('../../src/ai-service/service-configurations.js');
  const serviceConfig = getServiceConfig('plugin:deepseek-ai-service');

  const openai = new OpenAI({
    apiKey: serviceConfig.apiKey,
    baseURL: 'https://api.deepseek.com',
  });

  const { internalGenerateToolCalls } = await import('../../src/ai-service/openai.js');
  const { processFunctionCalls } = await import('../../src/ai-service/common.js');

  const last = prompt.slice(-1)[0];
  const lastText = last.text;
  if (requiredFunctionName) {
    if (last.type === 'user' && last.text && !last.text.includes('IMPORTANT REQUIREMENT')) {
      last.text += `\n\nIMPORTANT REQUIREMENT: Please respond to me with only one function call. The function called must be \`${requiredFunctionName}\`.`;
    }
  }

  let toolCalls: Awaited<ReturnType<typeof internalGenerateToolCalls>>;
  try {
    toolCalls = await internalGenerateToolCalls(
      prompt,
      functionDefs,
      requiredFunctionName,
      temperature,
      cheap,
      cheap
        ? (serviceConfig.modelOverrides?.cheap ?? 'deepseek-chat')
        : (serviceConfig.modelOverrides?.default ?? 'deepseek-chat'),
      openai,
    );
  } finally {
    if (lastText) {
      last.text = lastText;
    }
  }

  if (requiredFunctionName && toolCalls.length > 1) {
    console.log('Multiple function calls, but all are the same, so keeping only one.');
    toolCalls = toolCalls.filter((call) => call.function.name === requiredFunctionName).slice(0, 1);
  }

  const functionCalls = toolCalls.map((call) => {
    const name = call.function.name;
    const args = JSON.parse(call.function.arguments);

    return {
      id: call.id,
      name,
      args,
    };
  });

  return processFunctionCalls(functionCalls, functionDefs);
}

export default grokAiService;
