import { AiServiceType, CodegenOptions } from '../main/codegen-types.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import { askUserForConfirmation } from '../main/common/user-actions.js';
import { GenerateContentFunction } from '../ai-service/common.js';
import { abortController } from '../main/interactive/codegen-worker.js';

const AI_SERVICES_MAP = [
  [() => process.env.ANTHROPIC_API_KEY, 'anthropic'],
  [() => process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_REGION, 'vertex-ai-claude'],
  [() => process.env.OPENAI_API_KEY, 'chat-gpt'],
  [() => process.env.GOOGLE_CLOUD_PROJECT, 'vertex-ai'],
  [() => process.env.API_KEY, 'ai-studio'],
] as const;

export async function handleAiServiceFallback(
  generateContentFns: Record<AiServiceType, GenerateContentFunction>,
  currentService: AiServiceType,
  options: CodegenOptions,
  ...args: Parameters<GenerateContentFunction>
): Promise<ReturnType<GenerateContentFunction>> {
  let retryCount = 0;
  const maxRetries = AI_SERVICES_MAP.length;
  let permanentService = currentService;

  while (retryCount < maxRetries) {
    if (abortController?.signal.aborted) {
      putSystemMessage(`Operation interrupted for ${permanentService}`);
      throw new Error(`Operation interrupted`);
    }

    try {
      const result = await generateContentFns[permanentService](...args);
      options.aiService = permanentService;
      return result;
    } catch (error) {
      if (error instanceof Error) {
        // Check if the error is due to an interruption
        if (error.name === 'AbortError' || error.message.includes('interrupted')) {
          putSystemMessage(`Operation interrupted for ${permanentService}`);
          throw error; // Re-throw the interruption error
        }

        if (!options.disableAiServiceFallback && (options.interactive || options.ui)) {
          putSystemMessage(`Content generation failed for ${permanentService}`, { error });
          const shouldRetry = await askUserForConfirmation(`Content generation failed, do you want to retry?`, true);
          if (shouldRetry.confirmed) {
            continue;
          }
        }

        if (error.message.includes('Rate limit exceeded')) {
          putSystemMessage(`Rate limit exceeded for ${permanentService}`);

          if (!options.disableAiServiceFallback) {
            if (options.interactive || options.ui) {
              const nextService = getNextAiService(permanentService);
              if (nextService) {
                const shouldSwitch = await askUserForConfirmation(
                  `Rate limit exceeded for ${permanentService}. Would you like to switch to ${nextService}?`,
                  true,
                );
                if (shouldSwitch.confirmed) {
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
              putSystemMessage(
                `Rate limit exceeded for ${permanentService}. Automatically switching to ${nextService}.`,
              );
              permanentService = nextService;
              retryCount++;
            } else {
              throw new Error(`Rate limit exceeded for ${permanentService}. AI service fallback was not possible.`);
            }
          }
        } else {
          // For other types of errors, re-throw
          throw error;
        }
      } else {
        // If it's not an Error instance, re-throw
        throw error;
      }
    }
  }
  throw new Error('All AI services have been exhausted due to rate limiting.');
}

function getNextAiService(currentService: AiServiceType): AiServiceType | undefined {
  const options: AiServiceType[] = AI_SERVICES_MAP.filter(([check]) => check()).map(([, service]) => service);
  const currentIndex = options.indexOf(currentService);
  if (currentIndex === -1 || currentIndex === options.length - 1) {
    return undefined;
  }
  return options[currentIndex + 1];
}
