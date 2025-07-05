import { md5 } from '../../files/cache-file.js';
import { getSourceFiles, refreshFiles } from '../../files/find-files.js';
import { readFileContent, getSourceCode } from '../../files/read-files.js';
import { clearSummaryCache } from '../../files/summary-cache.js';
import { summarizeSourceCode } from './step-summarization.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { GenerateContentFunction, PromptItem, FunctionCall } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { executeStepEnsureContext } from './step-ensure-context.js';

type FilesState = Map<string, string>;

export function getFilesState(): FilesState {
  const state: FilesState = new Map();
  for (const file of getSourceFiles()) {
    try {
      const content = readFileContent(file);
      state.set(file, md5(content));
    } catch (error) {
      // file might have been deleted
    }
  }
  return state;
}

export async function executeStepAutoContextRefresh(
  previousState: FilesState,
  generateContentFn: GenerateContentFunction,
  options: CodegenOptions,
  prompt: PromptItem[],
): Promise<FilesState> {
  const currentState = getFilesState();
  const changedFiles: string[] = [];
  const newFiles: string[] = [];
  const deletedFiles: string[] = [];

  // Check for changed and deleted files
  for (const [file, checksum] of previousState.entries()) {
    if (!currentState.has(file)) {
      deletedFiles.push(file);
    } else if (currentState.get(file) !== checksum) {
      changedFiles.push(file);
    }
  }

  // Check for new files
  for (const file of currentState.keys()) {
    if (!previousState.has(file)) {
      newFiles.push(file);
    }
  }

  const allChangedFiles = [...changedFiles, ...newFiles, ...deletedFiles];

  if (allChangedFiles.length > 0) {
    putSystemMessage('File changes detected. Refreshing context...', {
      changed: changedFiles,
      added: newFiles,
      deleted: deletedFiles,
    });

    // 1. Refresh the list of source files
    refreshFiles();

    // 2. Clear the summary cache for modified files
    clearSummaryCache(allChangedFiles);

    // 3. Re-summarize the changed and new files
    const filesToSummarize = getSourceCode({ filterPaths: [...changedFiles, ...newFiles], forceAll: true }, options);
    if (Object.keys(filesToSummarize).length > 0) {
      await summarizeSourceCode(generateContentFn, filesToSummarize, options);
    }

    // 4. Remove stale content from prompt history to force a refresh
    for (const item of prompt) {
      if (item.type === 'user' && item.functionResponses) {
        for (const response of item.functionResponses) {
          if (response.name === 'getSourceCode' && response.content) {
            try {
              const sourceCode = JSON.parse(response.content);
              let modified = false;
              // Check all changed, new, and deleted files
              for (const file of allChangedFiles) {
                if (sourceCode[file]) {
                  delete sourceCode[file];
                  modified = true;
                }
              }
              if (modified) {
                response.content = JSON.stringify(sourceCode);
              }
            } catch (e) {
              // Ignore parsing errors, the content might not be valid JSON
            }
          }
        }
      }
    }

    // 5. Use executeStepEnsureContext to add fresh content for new and changed files
    const filesToEnsure = [...changedFiles, ...newFiles];
    if (filesToEnsure.length > 0) {
      const fakeFunctionCall: FunctionCall = {
        name: 'autoContextRefresh', // A descriptive name for the fake call
        args: {
          filePaths: filesToEnsure,
        },
      };
      await executeStepEnsureContext(prompt, fakeFunctionCall, options);
    }

    putSystemMessage('Context refreshed.');
  }

  return currentState;
}
