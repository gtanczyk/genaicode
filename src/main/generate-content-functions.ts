import { GenerateContentFunction } from '../ai-service/common-types.js';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentGitHubModels } from '../ai-service/github-models.js';
import { generateContent as generateContentLocalLllm } from '../ai-service/local-llm.js';
import { generateContent as generateContentGPT } from '../ai-service/openai.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';
import { getRegisteredAiServices } from './plugin-loader.js';

export function getGenerateContentFunctions(): Record<AiServiceType, GenerateContentFunction> {
  return {
    'vertex-ai': generateContentVertexAi,
    'ai-studio': generateContentAiStudio,
    anthropic: generateContentAnthropic,
    openai: generateContentGPT,
    'local-llm': generateContentLocalLllm,
    'github-models': generateContentGitHubModels,
    ...Object.fromEntries([...getRegisteredAiServices().entries()].map(([key, value]) => [key, value.generateContent])),
  };
}
