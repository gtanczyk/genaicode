import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../../../main/common/user-actions.js';
import { copyToContainer as utilCopyToContainer } from '../../../../../../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';
import { rcConfig } from '../../../../../../main/config.js';

export const getCopyToContainerDef: () => FunctionDef = () => ({
  name: 'copyToContainer',
  description: 'Copy a file or directory from the host to the container.',
  parameters: {
    type: 'object',
    properties: {
      hostPath: {
        type: 'string',
        description: `The absolute path of the file or directory on the host machine, which must be within the project root directory.\nThe file path must start from: ${rcConfig.rootDir}`,
      },
      containerPath: {
        type: 'string',
        description: 'The absolute destination path inside the container.',
      },
    },
    required: ['hostPath', 'containerPath'],
  },
});

type CopyToContainerArgs = {
  hostPath: string;
  containerPath: string;
};

export async function handleCopyToContainer(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'container' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container, options } = props;
  const args = actionResult.args as CopyToContainerArgs;
  putAssistantMessage(`Preparing to copy from host path "${args.hostPath}" to container path "${args.containerPath}".`);
  const confirmation = await askUserForConfirmation(`Do you want to proceed with the copy operation?`, true, options);

  if (!confirmation.confirmed) {
    putSystemMessage('Copy to container cancelled by user.');
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
            content: 'User cancelled the copy operation.',
          },
        ],
      },
    );
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  try {
    await utilCopyToContainer(container, args.hostPath, args.containerPath);
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
            content: `Successfully copied ${args.hostPath} to container path ${args.containerPath}.`,
          },
        ],
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage('❌ Error copying to container', { error: errorMessage });
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
            content: `Error: ${errorMessage}`,
          },
        ],
      },
    );
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
