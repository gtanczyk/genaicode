import fs from 'fs/promises';
import path from 'path';
import { isAncestorDirectory } from '../../../../files/file-utils.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { rcConfig } from '../../../../main/config.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import {
  ExploreExternalDirectoriesArgs,
  exploreExternalDirectories as exploreExternalDirectoriesDef,
} from '../../../function-defs/explore-external-directories.js';
import { ModelType, PromptItem, FunctionCall, GenerateContentResult } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';

// Threshold for triggering synthesis instead of listing all files
const SYNTHESIS_FILE_COUNT_THRESHOLD = 10;

registerActionHandler('exploreExternalDirectories', handleExploreExternalDirectories);

export async function handleExploreExternalDirectories({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Generating arguments for explore external directories action...');

  // 1. Infer arguments using LLM
  const inferencePrompt: PromptItem[] = [
    ...prompt,
    {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
    },
    {
      type: 'user',
      text: 'Given the conversation, identify the directories, reason, and any exploration parameters (recursive, depth, searchPhrases, maxResults) for exploring external directories.',
    },
  ];

  const inferenceResult = await generateContentFn(
    inferencePrompt,
    {
      modelType: ModelType.CHEAP,
      functionDefs: getFunctionDefs(),
      requiredFunctionName: exploreExternalDirectoriesDef.name,
    },
    options,
  );

  const inferredCall = inferenceResult.find((part) => part.type === 'functionCall')?.functionCall as
    | FunctionCall<ExploreExternalDirectoriesArgs>
    | undefined;

  if (!inferredCall || !inferredCall.args) {
    putSystemMessage(
      'Could not infer arguments for exploreExternalDirectories action from the assistant message and context.',
    );
    return { breakLoop: false, items: [] }; // Or respond with error
  }

  const inferredCallId = inferredCall.id;
  // Ensure depth is handled correctly as it's now required
  const { directories, reason: inferredReason, depth, ...restParams } = inferredCall.args;
  const requestedDirectories = directories;
  const reason = inferredReason;
  const executorParams = { depth, ...restParams }; // Includes recursive, searchPhrases, maxResults if provided

  putSystemMessage('Inferred arguments for explore external directories action.', executorParams);

  if (!requestedDirectories || requestedDirectories.length === 0 || !reason || typeof depth !== 'number' || depth < 0) {
    let errorMsg = 'Missing or invalid arguments after inferring for exploreExternalDirectories action.';
    if (!requestedDirectories || requestedDirectories.length === 0) errorMsg += ' Missing directories.';
    if (!reason) errorMsg += ' Missing reason.';
    if (typeof depth !== 'number' || depth < 0) errorMsg += ' Missing or invalid depth (must be >= 0).';

    putSystemMessage(errorMsg);
    // Respond with an error in the function response
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
        functionCalls: inferredCall ? [inferredCall] : undefined, // Include the inferred call attempt
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: exploreExternalDirectoriesDef.name,
            call_id: inferredCallId,
            content: JSON.stringify({
              error: `Invalid arguments inferred: ${errorMsg}`,
            }),
          },
        ],
      },
    );
    return { breakLoop: false, items: [] };
  }

  // 2. Validate directories are external
  const externalDirsToExplore: string[] = [];
  const internalDirsSkipped: string[] = [];
  const invalidDirs: string[] = [];

  for (const dir of requestedDirectories) {
    try {
      const absolutePath = path.resolve(dir);
      // Basic check if it's inside the project root (and not ignored)
      if (
        isAncestorDirectory(rcConfig.rootDir, absolutePath) &&
        !rcConfig.ignorePaths?.some(
          (ignorePath) =>
            path.join(rcConfig.rootDir, ignorePath) === absolutePath ||
            isAncestorDirectory(path.join(rcConfig.rootDir, ignorePath), absolutePath),
        )
      ) {
        internalDirsSkipped.push(absolutePath);
      } else {
        // Further validation (existence, directory type) could happen here or in exploreDirectories
        externalDirsToExplore.push(absolutePath);
      }
    } catch (error) {
      // path.resolve might throw if the path format is invalid on some OS
      invalidDirs.push(`${dir} (invalid path format)`);
    }
  }

  // Define userResponse structure
  let userResponse: {
    confirmed?: boolean;
    error?: string;
    filePaths?: string[]; // Included only if count <= threshold
    synthesis?: string; // Included only if count > threshold
    fileCount?: number; // Included only if count > threshold
    skipped?: string[];
    invalid?: string[];
  } = {};

  // 3. Handle validation results and Ask for confirmation
  if (invalidDirs.length > 0) {
    userResponse = {
      error: `Invalid or inaccessible directory paths provided: ${invalidDirs.join(', ')}`,
      invalid: invalidDirs,
    };
  } else if (externalDirsToExplore.length === 0) {
    userResponse.error = 'No valid external directories provided to explore.';
    if (internalDirsSkipped.length > 0) {
      userResponse.skipped = internalDirsSkipped;
      userResponse.error += ` Skipped internal directories: ${internalDirsSkipped.join(', ')}`;
    }
  } else {
    // Ask for confirmation
    const confirmationMessage = `The AI wants to explore the following external directorie(s):\n${externalDirsToExplore.join(
      '\n',
    )}\nDo you allow exploring these directories?`;

    const confirmationResult = await askUserForConfirmation(confirmationMessage, false, options);

    if (confirmationResult.confirmed) {
      try {
        putSystemMessage('Exploring external directory...');
        const filePaths = await exploreDirectories({
          directories: externalDirsToExplore,
          // Pass validated executorParams
          recursive: executorParams.recursive,
          depth: executorParams.depth,
          searchPhrases: executorParams.searchPhrases,
          maxResults: executorParams.maxResults,
        });

        userResponse.confirmed = true;
        if (internalDirsSkipped.length > 0) {
          userResponse.skipped = internalDirsSkipped;
        }

        // ---- Synthesis Logic ----
        if (filePaths.length > SYNTHESIS_FILE_COUNT_THRESHOLD) {
          putSystemMessage(`Found ${filePaths.length} files. Synthesizing results...`);
          userResponse.fileCount = filePaths.length;
          const synthesisPrompt: PromptItem[] = [
            {
              type: 'user',
              text: `You explored directories and found ${filePaths.length} files because: ${reason}.\nFiles:\n${filePaths.join('\\n')}\n\nBased on this reason, provide a concise and helpful output. Choose the most suitable format from summary, categorized list, or plain file list.`,
            },
          ];

          try {
            const synthesisResult: GenerateContentResult = await generateContentFn(
              synthesisPrompt,
              {
                modelType: ModelType.CHEAP,
                // Ensure we only expect text
                expectedResponseType: { text: true, functionCall: false, media: false },
              },
              { ...options, askQuestion: false }, // Don't allow asking questions during synthesis
            );

            const synthesizedText = synthesisResult.find((part) => part.type === 'text')?.text;
            if (synthesizedText) {
              userResponse.synthesis = synthesizedText;
              putSystemMessage(`Synthesis complete.`, { synthesizedText });
            } else {
              putSystemMessage('Synthesis failed: No text content returned from LLM.');
              userResponse.error = 'Exploration succeeded, but synthesis failed to generate content.';
              // Fallback? Maybe include filePaths if synthesis fails?
              // userResponse.filePaths = filePaths; // Or just report error
            }
          } catch (synthError) {
            const synthErrorMessage = synthError instanceof Error ? synthError.message : 'Unknown synthesis error.';
            putSystemMessage(`Synthesis failed: ${synthErrorMessage}`);
            userResponse.error = `Exploration succeeded, but synthesis failed: ${synthErrorMessage}`;
            // userResponse.filePaths = filePaths; // Optional fallback
          }
        } else {
          // No synthesis needed, include the paths directly
          userResponse.filePaths = filePaths;
        }
        // ---- End Synthesis Logic ----
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during execution.';
        putSystemMessage(`Error exploring external directories: ${errorMessage}`);
        userResponse = { ...userResponse, confirmed: true, error: `Exploration failed: ${errorMessage}` }; // Keep skipped/invalid if already set
      }
    } else {
      userResponse = {
        ...userResponse,
        confirmed: false,
        error: 'User denied permission to explore external directories.',
      }; // Keep skipped/invalid
    }
  }

  // 4. Update conversation history
  prompt.push(
    {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
      functionCalls: inferredCall ? [inferredCall] : undefined, // Use the inferred call
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: exploreExternalDirectoriesDef.name,
          call_id: inferredCallId, // Use the ID from the inferred call
          content: JSON.stringify({
            // Include original request details for context, even if modified by synthesis
            requestedDirectories,
            reason,
            ...executorParams,
            // Add the results (potentially synthesized)
            ...userResponse,
          }),
        },
      ],
    },
  );

  return {
    breakLoop: false,
    items: [], // No immediate items to add, handled by history push
  };
}

// Keep exploreDirectories function as is, ensuring it respects maxResults
async function exploreDirectories(args: {
  directories: string[];
  recursive?: boolean;
  depth: number; // Now required
  searchPhrases?: string[];
  maxResults?: number;
}): Promise<string[]> {
  const { directories, recursive = false, depth, searchPhrases, maxResults = 50 } = args;
  const foundFiles: string[] = [];
  // Depth is now required, maxDepth calculation is simpler
  const maxDepth = depth;
  const lowerCaseSearchPhrases = searchPhrases?.map((p) => p.toLowerCase());

  async function traverse(dirPath: string, currentDepth: number) {
    // Stop if max depth exceeded OR max results reached
    if (currentDepth > maxDepth || foundFiles.length >= maxResults) {
      return;
    }

    let entries;
    try {
      // Check access first to provide better error for invalidDirs later?
      await fs.access(dirPath, fs.constants.R_OK);
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      // Log or handle specific errors like permission denied
      // console.warn(`Could not read directory ${dirPath}: ${error}`);
      // Consider throwing if it's the initial directory?
      return; // Silently ignore inaccessible subdirectories
    }

    for (const entry of entries) {
      if (foundFiles.length >= maxResults) {
        break; // Stop processing entries in this directory if max results hit
      }
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        foundFiles.push(fullPath);
        // Only recurse if currentDepth < maxDepth
        if (recursive && currentDepth < maxDepth) {
          await traverse(fullPath, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        if (lowerCaseSearchPhrases && lowerCaseSearchPhrases.length > 0) {
          try {
            // Consider limiting file size read?
            const content = await fs.readFile(fullPath, 'utf-8');
            const lowerCaseContent = content.toLowerCase();
            if (lowerCaseSearchPhrases.every((phrase) => lowerCaseContent.includes(phrase))) {
              foundFiles.push(fullPath);
            }
          } catch (readError) {
            // Ignore file read errors?
            // console.warn(`Could not read file ${fullPath}: ${readError}`);
          }
        } else {
          // No search phrases, just add the file
          foundFiles.push(fullPath);
        }
      }
      // Ignore other entry types (symlinks, etc.)
    }
  }

  for (const startDir of directories) {
    if (foundFiles.length < maxResults) {
      // Start traversal at depth 0
      await traverse(startDir, 0);
    }
  }

  return foundFiles;
}
