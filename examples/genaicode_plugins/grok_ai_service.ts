import OpenAI from 'openai';
import { FunctionCall, FunctionDef, PromptItem, Plugin } from '../../src/index.js';

const grokAiService: Plugin = {
  name: 'grok-ai-service',
  aiServices: {
    'grok-ai-service': generateContent,
  },
};

async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
): Promise<FunctionCall[]> {
  const openai = new OpenAI({
    apiKey: process.env.GROK_OPENAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  });

  const { internalGenerateContent } = await import('../../src/ai-service/chat-gpt.js');

  return internalGenerateContent(prompt, functionDefs, requiredFunctionName, temperature, cheap, 'grok-beta', openai);
}

export default grokAiService;
