import { PromptItem } from '../../../../ai-service/common-types.js';
import { getSourceFiles } from '../../../../files/find-files.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { getExpandedContextPaths } from '../../../../files/source-code-utils.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

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

/**
 * Process file requests by checking if they are already provided and categorizing them
 * @param requestedFiles Array of file paths to process
 * @param prompt The conversation history
 * @param options Codegen options
 * @returns Processed file request information
 */
export function processFileRequests(
  requestedFiles: string[],
  prompt: PromptItem[],
  options: CodegenOptions,
): {
  requestedFiles: string[];
  alreadyProvidedFiles: string[];
  legitimateFiles: string[];
  illegitimateFiles: string[];
} {
  // Expand context paths
  requestedFiles = getExpandedContextPaths(requestedFiles, options);

  // Check which files are already provided in the conversation history
  const alreadyProvidedFiles = requestedFiles.filter((file) => isFileContentAlreadyProvided(file, prompt));

  // Filter out already provided files
  requestedFiles = requestedFiles.filter((file) => !isFileContentAlreadyProvided(file, prompt));

  // Refresh files in case new files appeared
  refreshFiles();

  // Categorize files into legitimate and illegitimate
  const { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  putSystemMessage('Processing file requests', {
    requestedFiles,
    alreadyProvidedFiles,
    legitimateFiles,
    illegitimateFiles,
  });

  return {
    requestedFiles,
    alreadyProvidedFiles,
    legitimateFiles,
    illegitimateFiles,
  };
}

/**
 * Generate a user-friendly message about file processing status
 * @param alreadyProvidedFiles Files already provided in conversation
 * @param requestedFiles Files that were requested
 * @param legitimateFiles Files that are legitimate and will be processed
 * @param illegitimateFiles Files that are not legitimate
 * @param type Type of content being provided ('content' or 'fragments')
 * @returns A formatted message string
 */
export function generateFilesContentPrompt(
  alreadyProvidedFiles: string[],
  requestedFiles: string[],
  legitimateFiles: string[],
  illegitimateFiles: string[],
  type: 'content' | 'fragments',
): string {
  return (
    (alreadyProvidedFiles.length > 0
      ? `Some files were already provided in the conversation history:
${alreadyProvidedFiles.map((path) => `- ${path}`).join('\n')}

Providing ${type} for the remaining files:
${requestedFiles.map((path) => `- ${path}`).join('\n')}`
      : `All requested file ${type} have been provided:
${legitimateFiles.map((path) => `- ${path}`).join('\n')}`) +
    (illegitimateFiles.length > 0
      ? `\n\nSome files are not legitimate and their ${type} cannot be provided:
${illegitimateFiles.map((path) => `- ${path}`).join('\n')}`
      : '')
  );
}
