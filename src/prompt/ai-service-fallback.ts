import { CodegenOptions } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import { askUserForConfirmation } from '../main/common/user-actions.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';
import { abortController } from '../main/common/abort-controller.js';

export async function handleAiServiceFallback(
  generateContentFns: Record<AiServiceType, GenerateContentFunction>,
  options: CodegenOptions,
  ...args: Parameters<GenerateContentFunction>
): Promise<ReturnType<GenerateContentFunction>> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (abortController?.signal.aborted) {
      putSystemMessage(`Operation interrupted for ${options.aiService}`);
      throw new Error(`Operation interrupted`);
    }

    try {
      const result = await generateContentFns[options.aiService](...args);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        // Check if the error is due to an interruption
        if (error.name === 'AbortError' || error.message.includes('interrupted')) {
          putSystemMessage(`Operation interrupted for ${options.aiService}`);
          throw error; // Re-throw the interruption error
        }

        if (!options.disableAiServiceFallback && (options.interactive || options.ui)) {
          putSystemMessage(`Content generation failed for ${options.aiService}`, { error });
          const shouldRetry = await askUserForConfirmation(
            `Content generation failed, do you want to retry?`,
            true,
            options,
          );
          if (shouldRetry.confirmed) {
            continue;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      } else {
        // If it's not an Error instance, re-throw
        throw error;
      }
    }
  }
}
