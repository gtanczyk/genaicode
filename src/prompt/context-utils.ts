import { PromptItem } from '../ai-service/common-types.js';
import { SourceCodeMap } from '../files/source-code-types.js';
import { estimateTokenCount } from './token-estimator.js';

/**
 * Calculates the total token count of file contents from getSourceCode responses within a prompt.
 * @param prompt The array of prompt items to scan.
 * @returns The total estimated token count for all file contents.
 */
export function getFilesContextSizeFromPrompt(prompt: PromptItem[]): number {
  let totalTokenCount = 0;

  for (const item of prompt) {
    if (!item.functionResponses) {
      continue;
    }

    for (const response of item.functionResponses) {
      if (response.name === 'getSourceCode' && response.content) {
        try {
          const sourceCodeMap = JSON.parse(response.content) as SourceCodeMap;
          for (const filePath in sourceCodeMap) {
            const fileData = sourceCodeMap[filePath];
            // Check if 'content' property exists and is not null
            if (fileData && 'content' in fileData && typeof fileData.content === 'string') {
              totalTokenCount += estimateTokenCount(fileData.content);
            }
          }
        } catch (error) {
          console.warn('Failed to parse getSourceCode response while calculating context size:', error);
        }
      }
    }
  }

  return totalTokenCount;
}
