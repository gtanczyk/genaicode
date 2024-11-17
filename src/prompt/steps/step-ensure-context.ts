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
  codegenSummaryCall: FunctionCall,
  options: CodegenOptions,
): Promise<StepResult> {
  try {
    // Extract all required paths
    const requiredPaths = extractRequiredPaths(codegenSummaryCall);
    if (requiredPaths.length === 0) {
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
    const sourceCode = getSourceCode({ filterPaths: missingPaths }, options);

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
 * Extract all required file paths from codegenSummary function call
 */
function extractRequiredPaths(codegenSummaryCall: FunctionCall): string[] {
  if (!codegenSummaryCall.args?.fileUpdates || !codegenSummaryCall.args?.contextPaths) {
    throw new Error('Invalid codegenSummary call: missing fileUpdates or contextPaths');
  }

  // Ensure fileUpdates is an array and has the correct type
  const fileUpdatePaths = Array.isArray(codegenSummaryCall.args.fileUpdates)
    ? codegenSummaryCall.args.fileUpdates.map((update: { filePath: string }) => update.filePath)
    : [];

  const contextPaths = codegenSummaryCall.args.contextPaths as string[];
  const importantPaths = importantContext.files ?? [];

  // Use Set to deduplicate paths
  return Array.from(new Set([...fileUpdatePaths, ...contextPaths, ...importantPaths]));
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
