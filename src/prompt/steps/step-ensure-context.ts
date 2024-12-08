import { FunctionCall } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { importantContext } from '../../main/config.js';
import { getSourceCode } from '../../files/read-files.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { StepResult } from './steps-types.js';
import { getSourceCodeTree } from '../../files/source-code-tree.js';

/**
 * Executes the context completeness check step.
 * Ensures all necessary files are included in the conversation context.
 */
export async function executeStepEnsureContext(
  prompt: { type: string; functionResponses?: { name: string; content?: string }[]; functionCalls?: FunctionCall[] }[],
  functionCall: FunctionCall,
  options: CodegenOptions,
): Promise<StepResult> {
  try {
    // Extract all required paths
    const requiredPaths = extractRequiredPaths(functionCall);
    if (!requiredPaths || requiredPaths.length === 0) {
      putSystemMessage('No paths to ensure in context.');
      return StepResult.CONTINUE;
    }

    // Get paths that are already in context
    const existingPaths = getExistingContextPaths(prompt);

    // Find paths that are missing from context
    const missingPaths = requiredPaths.filter((path) => !existingPaths.has(path));
    if (missingPaths.length === 0) {
      putSystemMessage('All required paths are already in context.');
      return StepResult.CONTINUE;
    }

    // Get source code for missing paths
    putSystemMessage(`Ensuring context completeness. Adding ${missingPaths.length} missing files.`, { missingPaths });
    const sourceCode = getSourceCode(
      { filterPaths: missingPaths, forceAll: true, ignoreImportantFiles: true },
      options,
    );

    // Append getSourceCode function call/response to the prompt
    prompt.push(
      {
        type: 'assistant',
        functionCalls: [
          {
            name: 'getSourceCode',
            args: {
              filePaths: missingPaths,
            },
          },
        ],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'getSourceCode',
            content: JSON.stringify(getSourceCodeTree(sourceCode)),
          },
        ],
      },
    );

    putSystemMessage('Context completeness check completed successfully.');
    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('Error: Context completeness check failed. This is unexpected.');
    console.error('Context completeness check error:', error);
    return StepResult.BREAK;
  }
}

/**
 * Extract all required file paths from function call using flexible extraction strategies
 */
function extractRequiredPaths(functionCall: FunctionCall): string[] {
  const paths: string[] = [];

  // Extract paths from function call arguments
  if (functionCall.args) {
    // Handle codegenSummary specific structure (backward compatibility)
    if (functionCall.name === 'codegenSummary') {
      if (Array.isArray(functionCall.args.fileUpdates)) {
        paths.push(
          ...functionCall.args.fileUpdates
            .filter((update): update is { filePath: string } => typeof update === 'object' && update !== null)
            .map((update) => update.filePath),
        );
      }
      if (Array.isArray(functionCall.args.contextPaths)) {
        paths.push(...functionCall.args.contextPaths.filter((path): path is string => typeof path === 'string'));
      }
    } else if (functionCall.name === 'codegenPlanning') {
      if (Array.isArray(functionCall.args.affectedFiles)) {
        paths.push(
          ...functionCall.args.affectedFiles.map((file) => [file.filePath, ...(file.dependencies ?? [])]).flat(),
        );
      }
    }
  }

  // Add important context paths
  const importantPaths = importantContext.files ?? [];
  paths.push(...importantPaths);

  // Deduplicate and filter out empty/invalid paths
  return Array.from(new Set(paths)).filter((path) => typeof path === 'string' && path.length > 0);
}

/**
 * Get paths that are already present in the conversation context
 */
function getExistingContextPaths(prompt: { functionResponses?: { name: string; content?: string }[] }[]): Set<string> {
  const existingPaths = new Set<string>();

  for (const item of prompt) {
    if (!item.functionResponses) continue;

    const sourceCodeResponse = item.functionResponses.find((response) => response.name === 'getSourceCode');
    if (!sourceCodeResponse?.content) continue;

    try {
      const sourceCode = JSON.parse(sourceCodeResponse.content);
      for (const [dirPath, files] of Object.entries(sourceCode)) {
        for (const [fileName, fileInfo] of Object.entries(files as Record<string, unknown>)) {
          const fullPath = `${dirPath}/${fileName}`;
          if (fileInfo && typeof fileInfo === 'object' && 'content' in fileInfo && fileInfo.content !== null) {
            existingPaths.add(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse getSourceCode response:', error);
    }
  }

  return existingPaths;
}
