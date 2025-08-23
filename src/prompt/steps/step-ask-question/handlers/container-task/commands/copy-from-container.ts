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
  copyFromContainer as utilCopyFromContainer,
  listFilesInContainerArchive,
  checkPathExistsInContainer,
} from '../../../../../../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';
import { rcConfig } from '../../../../../../main/config.js';
import { isAncestorDirectory } from '../../../../../../files/file-utils.js';

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
        description: `The absolute destination path on the host machine, which must be within the project root directory.\nThe file path must start from: ${rcConfig.rootDir}`,
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
            name: 'copyFromContainer',
            call_id: actionResult.id || undefined,
            content: 'Operation cancelled by user.',
          },
        ],
      },
    );
    return { shouldBreakOuter: true, commandsExecutedIncrement: 0 };
  }
  try {
    if (!isAncestorDirectory(rcConfig.rootDir, args.hostPath)) {
      const errorMsg = `Invalid host path: ${args.hostPath}. It must be within the project root directory: ${rcConfig.rootDir}`;
      putContainerLog('error', errorMsg, args, 'copy');
      putSystemMessage(`❌ ${errorMsg}`);
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'copyToContainer',
              call_id: actionResult.id || undefined,
              content: `Error: Invalid host path. It must be within the project root directory: ${rcConfig.rootDir}.`,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    // check if container path exists in container
    if (!(await checkPathExistsInContainer(container, args.containerPath))) {
      const errorMsg = `Invalid container path: ${args.containerPath}. It must be a valid path inside the container.`;
      putContainerLog('error', errorMsg, args, 'copy');
      putSystemMessage(`❌ ${errorMsg}`);
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'copyToContainer',
              call_id: actionResult.id || undefined,
              content: `Error: Invalid container path. It must be a valid path inside the container.`,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    const filesToCopy = await listFilesInContainerArchive(container, args.containerPath);
    if (filesToCopy.length === 0) {
      const message = `No files found at container path "${args.containerPath}" to copy.`;
      putSystemMessage(message);
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'copyFromContainer',
              call_id: actionResult.id || undefined,
              content: message,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    putContainerLog('info', `Found ${filesToCopy.length} files to copy from container`, { filesToCopy }, 'copy');
    putAssistantMessage(
      `The following files will be copied from container path "${args.containerPath}" to host path "${args.hostPath}"`,
      {
        filesToCopy,
      },
    );
    const confirmation = await askUserForConfirmationWithAnswer(`Do you want to proceed?`, 'Yes', 'No', true, options);
    if (confirmation.answer) {
      putUserMessage(confirmation.answer);
    }

    if (!confirmation.confirmed) {
      putContainerLog('warn', 'Copy from container cancelled by user.', undefined, 'copy');
      putSystemMessage('Copy from container cancelled by user.');
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          text: 'I reject the copy operation.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
          functionResponses: [
            {
              name: 'copyFromContainer',
              call_id: actionResult.id || undefined,
            },
          ],
        },
      );
      return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
    }

    await utilCopyFromContainer(container, args.containerPath, args.hostPath);
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        text: 'I accept the copy operation.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        functionResponses: [
          {
            name: 'copyFromContainer',
            call_id: actionResult.id || undefined,
            content: `Successfully copied from container path ${args.containerPath} to ${args.hostPath}.`,
          },
        ],
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', 'Error copying from container', { error: errorMessage }, 'copy');
    putSystemMessage('❌ Error copying from container', { error: errorMessage });
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'copyFromContainer',
            call_id: actionResult.id || undefined,
            content: `Error: ${errorMessage}`,
          },
        ],
      },
    );
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
