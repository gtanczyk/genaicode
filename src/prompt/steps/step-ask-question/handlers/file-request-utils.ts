import { PromptItem } from '../../../../ai-service/common-types.js';
import { getSourceFiles } from '../../../../files/find-files.js';

/**
 * Checks if a file's content is already provided in the conversation history
 * @param filePath The path of the file to check
 * @param prompt The conversation history
 * @returns true if the file content is already available in the history
 */
export function isFileContentAlreadyProvided(filePath: string, prompt: PromptItem[]): boolean {
  return prompt.some((item) => {
    if (item.type !== 'user' || !item.functionResponses) {
      return false;
    }

    return item.functionResponses.some((response) => {
      if (response.name !== 'getSourceCode' || !response.content) {
        return false;
      }

      try {
        const sourceCodeMap = JSON.parse(response.content);

        return (
          sourceCodeMap[filePath] &&
          sourceCodeMap[filePath] &&
          'content' in sourceCodeMap[filePath] &&
          sourceCodeMap[filePath].content !== null
        );
      } catch (error) {
        console.warn('Error parsing getSourceCode response:', error);
        return false;
      }
    });
  });
}

/**
 * Categorizes requested files into legitimate and illegitimate files
 * @param requestedFiles Array of file paths to categorize
 * @returns Object containing arrays of legitimate and illegitimate file paths
 */
export function categorizeLegitimateFiles(requestedFiles: string[]): {
  legitimateFiles: string[];
  illegitimateFiles: string[];
} {
  const legitimateFiles: string[] = [];
  const illegitimateFiles: string[] = [];
  // TODO: allow some small mistakes in the path, fix them to correct paths

  requestedFiles.forEach((filePath) => {
    if (isFilePathLegitimate(filePath)) {
      legitimateFiles.push(filePath);
    } else {
      illegitimateFiles.push(filePath);
    }
  });

  return { legitimateFiles, illegitimateFiles };
}

/**
 * Checks if a file path is legitimate (exists in the source files)
 * @param filePath The path of the file to check
 * @returns true if the file path is legitimate
 */
export function isFilePathLegitimate(filePath: string): boolean {
  return getSourceFiles().includes(filePath);
}
