import path from 'path';
import fs from 'fs';
import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { abortController } from '../../../../../../main/common/abort-controller.js';
import {
  putAssistantMessage,
  putContainerLog,
  putSystemMessage,
  putUserMessage,
} from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../../main/common/user-actions.js';
import {
  checkPathExistsInContainer,
  copyFromContainer,
  getFileContentFromContainer,
  listFilesInContainerArchive,
} from '../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { rcConfig } from '../../../../../../main/config.js';
import { isAncestorDirectory } from '../../../../../../files/file-utils.js';
import { getSourceCode } from '../../../../../../files/read-files.js';

export const getCopyFromContainerDef: () => FunctionDef = () => ({
  name: 'copyFromContainer',
  description: 'Copy a file or directory from the container to the host.',
  parameters: {
    type: 'object',
    properties: {
      containerPath: {
        type: 'string',
        description:
          'The absolute destination path on the host machine, which must be within the project root directory.',
      },
      hostPath: {
        type: 'string',
        description: `The absolute destination path on the host machine, which must be within the project root directory. The file path must start from: ${rcConfig.rootDir}`,
      },
    },
    required: ['containerPath', 'hostPath'],
  },
});

type CopyFromContainerArgs = {
  containerPath: string;
  hostPath: string;
};

export async function handleCopyFromContainer(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'container' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container, options } = props;
  const args = actionResult.args as CopyFromContainerArgs;

  if (abortController?.signal.aborted) {
    putContainerLog('warn', 'Copy from container cancelled by user.', undefined, 'copy');
    taskExecutionPrompt.push(
      { type: 'assistant', functionCalls: [actionResult] },
      {
        type: 'user',
        functionResponses: [
          {
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: 'Operation cancelled by user.',
          },
        ],
      },
    );
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  try {
    if (!isAncestorDirectory(rcConfig.rootDir, args.hostPath)) {
      const errorMsg = `Invalid host path: ${args.hostPath}. It must be within the project root directory: ${rcConfig.rootDir}`;
      putContainerLog('error', errorMsg, args, 'copy');
      putSystemMessage(`❌ ${errorMsg}`);
      taskExecutionPrompt.push(
        { type: 'assistant', functionCalls: [actionResult] },
        {
          type: 'user',
          functionResponses: [
            {
              name: actionResult.name,
              call_id: actionResult.id || undefined,
              content: `Error: Invalid host path. It must be within the project root directory: ${rcConfig.rootDir}.`,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    if (!(await checkPathExistsInContainer(container, args.containerPath))) {
      const errorMsg = `Invalid container path: ${args.containerPath}. It must be a valid path inside the container.`;
      putContainerLog('error', errorMsg, args, 'copy');
      putSystemMessage(`❌ ${errorMsg}`);
      taskExecutionPrompt.push(
        { type: 'assistant', functionCalls: [actionResult] },
        {
          type: 'user',
          functionResponses: [
            {
              name: actionResult.name,
              call_id: actionResult.id || undefined,
              content: `Error: Invalid container path. It must be a valid path inside the container.`,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    const entriesToCopy = await listFilesInContainerArchive(container, args.containerPath);
    if (entriesToCopy.length === 0) {
      const message = `No files or directories found at container path "${args.containerPath}" to copy.`;
      putSystemMessage(message);
      taskExecutionPrompt.push(
        { type: 'assistant', functionCalls: [actionResult] },
        {
          type: 'user',
          functionResponses: [{ name: actionResult.name, call_id: actionResult.id || undefined, content: message }],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    let extractionHostPath = args.hostPath;
    if (entriesToCopy.length === 1 && path.basename(args.containerPath) === path.basename(args.hostPath)) {
      extractionHostPath = path.dirname(args.hostPath);
      putContainerLog(
        'info',
        'Host path appears to be a file path for a single file copy. Adjusting destination to parent directory.',
        { original: args.hostPath, adjusted: extractionHostPath },
        'copy',
      );
    }

    const updatesForSummary: { name: string; args: Record<string, unknown> }[] = [];
    const hostFilePaths = entriesToCopy
      .filter((e) => e.type === 'file')
      .map((entry) => path.join(extractionHostPath, entry.name));
    const existingSources = getSourceCode({ filterPaths: hostFilePaths, forceAll: true }, options);

    for (const entry of entriesToCopy) {
      const hostFilePath = path.join(extractionHostPath, entry.name);
      if (!isAncestorDirectory(rcConfig.rootDir, hostFilePath)) {
        putContainerLog(
          'warn',
          `Skipping entry: ${hostFilePath} as it is outside the project root directory.`,
          undefined,
          'copy',
        );
        continue;
      }

      if (entry.type === 'directory') {
        if (!fs.existsSync(hostFilePath)) {
          updatesForSummary.push({
            name: 'createDirectory',
            args: {
              filePath: hostFilePath,
              explanation: `Directory will be created as it does not exist on the host.`,
            },
          });
        }
      } else if (entry.type === 'file') {
        const containerFilePath =
          path.basename(args.containerPath) === entry.name
            ? args.containerPath
            : path.join(args.containerPath, entry.name);
        const newContent = await getFileContentFromContainer(container, containerFilePath);
        const sourceFile = existingSources[hostFilePath];
        const oldContent = sourceFile && 'content' in sourceFile ? sourceFile.content : undefined;
        const toolName = fs.existsSync(hostFilePath) ? 'updateFile' : 'createFile';

        updatesForSummary.push({
          name: toolName,
          args: {
            filePath: hostFilePath,
            newContent,
            oldContent,
            explanation: `Copied from container path: ${containerFilePath}`,
          },
        });
      }
    }

    if (updatesForSummary.length === 0) {
      const message = `No files to copy after filtering.`;
      putSystemMessage(message);
      taskExecutionPrompt.push(
        { type: 'assistant', functionCalls: [actionResult] },
        {
          type: 'user',
          functionResponses: [{ name: actionResult.name, call_id: actionResult.id || undefined, content: message }],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    putContainerLog('info', `Found ${entriesToCopy.length} entries to copy from container`, { entriesToCopy }, 'copy');
    putAssistantMessage(
      `The following changes will be applied from container path "${args.containerPath}" to host path "${extractionHostPath}"`,
      { fileUpdates: updatesForSummary },
    );

    const confirmation = await askUserForConfirmationWithAnswer(
      `Do you want to proceed?`,
      'Copy to host',
      'Reject',
      true,
      options,
    );
    if (confirmation.answer) {
      putUserMessage(confirmation.answer);
    }

    if (!confirmation.confirmed) {
      putContainerLog('warn', 'Copy from container cancelled by user.', undefined, 'copy');
      putSystemMessage('Copy from container cancelled by user.');
      taskExecutionPrompt.push(
        { type: 'assistant', functionCalls: [actionResult] },
        {
          type: 'user',
          text: 'I reject the copy operation.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
          functionResponses: [{ name: actionResult.name, call_id: actionResult.id || undefined }],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    if (options.dryRun) {
      putSystemMessage('Dry run mode, not copying files from container');
    } else {
      await copyFromContainer(container, args.containerPath, extractionHostPath);
    }

    taskExecutionPrompt.push(
      { type: 'assistant', functionCalls: [actionResult] },
      {
        type: 'user',
        text: 'I accept the copy operation.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        functionResponses: [
          {
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: `Successfully copied from container path ${args.containerPath} to ${extractionHostPath}.`,
          },
        ],
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', 'Error copying from container', { error: errorMessage }, 'copy');
    putSystemMessage('❌ Error copying from container', { error: errorMessage });
    taskExecutionPrompt.push(
      { type: 'assistant', functionCalls: [actionResult] },
      {
        type: 'user',
        functionResponses: [
          { name: actionResult.name, call_id: actionResult.id || undefined, content: `Error: ${errorMessage}` },
        ],
      },
    );
  }

  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
