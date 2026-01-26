import path from 'path';
import { isAncestorDirectory } from '../../../../files/file-utils.js';
import { readFileContent } from '../../../../files/read-files.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { ActionHandlerProps, ActionResult, ReadExternalFilesArgs } from '../step-iterate-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ModelType, PromptItem, FunctionCall } from '../../../../ai-service/common-types.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { rcConfig } from '../../../../main/config.js';
import { readExternalFiles as readExternalFilesDef } from '../../../function-defs/read-external-files.js';
import { getFunctionDefs } from '../../../function-calling.js';

registerActionHandler('readExternalFiles', handleReadExternalFiles);

export async function handleReadExternalFiles({
  iterateCall,
  options,
  generateContentFn,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> {
  // 1. Infer arguments using LLM
  let inferredCall: FunctionCall<ReadExternalFilesArgs> | undefined;
  let requestedFilePaths: string[] | undefined;
  let reason: string | undefined;
  let inferredCallId: string | undefined;

  putSystemMessage('Generating arguments for reading external files action...');

  try {
    const inferencePrompt: PromptItem[] = [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Given the following conversation, identify the file paths and the reason for reading those files.',
      },
    ];

    const inferenceResult = await generateContentFn(
      inferencePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: readExternalFilesDef.name,
      },
      options,
    );

    inferredCall = inferenceResult.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<ReadExternalFilesArgs>
      | undefined;

    if (!inferredCall || !inferredCall.args) {
      putSystemMessage(
        'Could not infer arguments for readExternalFiles action from the assistant message and context.',
      );
      return { breakLoop: false, items: [] };
    }

    requestedFilePaths = inferredCall.args.externalFilePaths;
    reason = inferredCall.args.reason;
    inferredCallId = inferredCall.id;

    putSystemMessage('Generated arguments for reading external files', inferredCall.args);

    if (!requestedFilePaths || requestedFilePaths.length === 0 || !reason) {
      putSystemMessage('Missing filePaths or reason after inferring arguments for readExternalFiles action.');
      return { breakLoop: false, items: [] };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during argument inference.';
    putSystemMessage(`Error inferring arguments for readExternalFiles: ${errorMessage}`);
    return { breakLoop: false, items: [] };
  }

  // 2. Classify files and prepare for batch confirmation
  const fileResults: { filePath: string; result: string }[] = [];
  const externalFilesToConfirm: string[] = [];
  const internalFilesSkipped: string[] = [];

  for (const filePath of requestedFilePaths) {
    const absolutePath = path.resolve(filePath);

    if (isAncestorDirectory(rcConfig.rootDir, absolutePath)) {
      // File is inside the project root, skip
      fileResults.push({
        filePath: absolutePath,
        result: 'skipped, because it is not an external file, it is inside the project root',
      });
      internalFilesSkipped.push(absolutePath);
    } else {
      // File is external, add to confirmation list
      externalFilesToConfirm.push(absolutePath);
    }
  }

  // 3. Ask for batch confirmation if external files exist
  let confirmed = false;
  if (externalFilesToConfirm.length > 0) {
    const confirmationMessage = `The AI wants to read the following external file(s):\n${externalFilesToConfirm.join('\n')}\n\nReason: ${reason}\n\nDo you allow reading these files? Only processed information relevant to the reason will be used, not the full content.`;
    const confirmationResult = await askUserForConfirmation(confirmationMessage, false, options);
    confirmed = confirmationResult.confirmed ?? false;
  }

  // 4. Process confirmed external files or mark as denied
  if (confirmed) {
    putSystemMessage('Reading external files...', externalFilesToConfirm);

    for (const absolutePath of externalFilesToConfirm) {
      try {
        const content = readFileContent(absolutePath);

        // Call LLM to process the content based on the reason
        const processPrompt: PromptItem[] = [
          {
            type: 'user',
            text: `Extract information relevant to the reason: '${reason}' from the following content:\n\nContent:\n\n${content}\n\n`,
          },
        ];
        const processResult = await generateContentFn(processPrompt, { modelType: ModelType.CHEAP }, options);
        const processedText = processResult.find((part) => part.type === 'text')?.text ?? 'Could not process content.';

        fileResults.push({ filePath: absolutePath, result: processedText });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error during file reading or processing.';
        putSystemMessage(`Error reading or processing external file ${absolutePath}: ${errorMessage}`);
        fileResults.push({
          filePath: absolutePath,
          result: `Error reading or processing external file: ${errorMessage}`,
        });
      }
    }
    putSystemMessage('Finished reading external files.', { fileResults });
  } else if (externalFilesToConfirm.length > 0) {
    putSystemMessage('User denied access to external files.');
    // User denied access for the batch
    for (const absolutePath of externalFilesToConfirm) {
      fileResults.push({ filePath: absolutePath, result: 'access denied by the user' });
    }
  }

  // 5. Update conversation history
  prompt.push(
    {
      type: 'assistant',
      text: iterateCall.args?.message ?? '',
      functionCalls: [
        {
          id: inferredCallId,
          name: readExternalFilesDef.name,
          args: {
            externalFilePaths: requestedFilePaths, // Use original requested paths
            reason,
          },
        },
      ],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: readExternalFilesDef.name,
          call_id: inferredCallId,
          content: JSON.stringify({
            externalFilePaths: requestedFilePaths, // Use original requested paths
            reason,
            fileResults: fileResults, // Contains results for all initially requested files
          }),
        },
      ],
    },
  );

  return {
    breakLoop: false,
    items: [],
  };
}
