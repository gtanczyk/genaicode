import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../../../main/common/user-actions.js';
import {
  copyFromContainer as utilCopyFromContainer,
  listFilesInContainerArchive,
} from '../../../../../../utils/docker-utils.js';
import { CopyFromContainerArgs } from '../container-task-types.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';
import { rcConfig } from '../../../../../../main/config.js';

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

export async function handleCopyFromContainer(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'container' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container, options } = props;
  const args = actionResult.args as CopyFromContainerArgs;
  try {
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

    const fileListStr = filesToCopy.map((f) => `  - ${f}`).join('\\n');
    putAssistantMessage(
      `The following files will be copied from container path "${args.containerPath}" to host path "${args.hostPath}":\\n${fileListStr}`,
    );
    const confirmation = await askUserForConfirmation(`Do you want to proceed?`, true, options);

    if (!confirmation.confirmed) {
      putSystemMessage('Copy from container cancelled by user.');
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
              content: 'User cancelled the copy operation.',
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
