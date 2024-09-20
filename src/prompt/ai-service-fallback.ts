import { AiServiceType, CodegenOptions } from '../main/codegen-types';
import { putSystemMessage } from '../main/common/content-bus';
import { askUserForConfirmation } from '../main/common/user-actions';
import { GenerateContentFunction } from '../ai-service/common';

const AI_SERVICE_FALLBACK_ORDER: AiServiceType[] = [
  process.env.ANTHROPIC_API_KEY ? 'anthropic' : undefined,
  process.env.OPENAI_API_KEY ? 'chat-gpt' : undefined,
  process.env.GOOGLE_CLOUD_PROJECT ? 'vertex-ai-claude' : undefined,
  process.env.GOOGLE_CLOUD_PROJECT ? 'vertex-ai' : undefined,
  process.env.API_KEY ? 'ai-studio' : undefined,
].filter((service) => service) as AiServiceType[];

export async function handleAiServiceFallback(
  generateContentFns: Record<AiServiceType, GenerateContentFunction>,
  currentService: AiServiceType,
  options: CodegenOptions,
  ...args: Parameters<GenerateContentFunction>
): Promise<ReturnType<GenerateContentFunction>> {
  let retryCount = 0;
  const maxRetries = AI_SERVICE_FALLBACK_ORDER.length;
  let permanentService = currentService;

  while (retryCount < maxRetries) {
    try {
      const result = await generateContentFns[permanentService](...args);
      options.aiService = permanentService;
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        putSystemMessage(`Rate limit exceeded for ${permanentService}`);

        if (options.disableAiServiceFallback) {
          if (options.interactive || options.ui) {
            const nextService = getNextAiService(permanentService);
            if (nextService) {
              const shouldSwitch = await askUserForConfirmation(
                `Rate limit exceeded for ${permanentService}. Would you like to switch to ${nextService}?`,
                true,
              );
              if (shouldSwitch) {
                putSystemMessage(`Switching to ${nextService} due to rate limiting.`);
                permanentService = nextService;
                retryCount++;
                continue;
              }
            }
          } else {
            throw new Error(`Rate limit exceeded for ${permanentService}. AI service fallback is disabled.`);
          }
        } else {
          const nextService = getNextAiService(permanentService);
          if (nextService) {
            putSystemMessage(`Rate limit exceeded for ${permanentService}. Automatically switching to ${nextService}.`);
            permanentService = nextService;
            retryCount++;
          } else {
            throw new Error(`Rate limit exceeded for ${permanentService}. AI service fallback was not possible.`);
          }
        }
      }
      throw error;
    }
  }
  throw new Error('All AI services have been exhausted due to rate limiting.');
}

function getNextAiService(currentService: AiServiceType): AiServiceType | undefined {
  const currentIndex = AI_SERVICE_FALLBACK_ORDER.indexOf(currentService);
  if (currentIndex === -1 || currentIndex === AI_SERVICE_FALLBACK_ORDER.length - 1) {
    return undefined;
  }
  return AI_SERVICE_FALLBACK_ORDER[currentIndex + 1];
}
