import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { abortController } from '../../../../../../main/common/abort-controller.js';
import {
  putAssistantMessage,
  putContainerLog,
  putSystemMessage,
  putUserMessage,
} from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../../main/common/user-actions.js';
import { checkPathExistsInContainer, copyToContainer as utilCopyToContainer } from '../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { rcConfig } from '../../../../../../main/config.js';
import { isAncestorDirectory } from '../../../../../../files/file-utils.js';

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

  if (abortController?.signal.aborted) {
    putContainerLog('warn', 'Copy to container cancelled by user.', undefined, 'copy');
    taskExecutionPrompt.push(
      { type: 'assistant', functionCalls: [actionResult] },
      {
        type: 'user',
        functionResponses: [
          { name: actionResult.name, call_id: actionResult.id || undefined, content: 'Operation cancelled by user.' },
        ],
      },
    );
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  // check if hostPath belongs to the project directory
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
            name: actionResult.name,
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
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: `Error: Invalid container path. It must be a valid path inside the container. The path must exist, perhaps you need to create the directory first.`,
          },
        ],
      },
    );
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  putAssistantMessage(`Preparing to copy from host path "${args.hostPath}" to container path "${args.containerPath}".`);
  const confirmation = await askUserForConfirmationWithAnswer(
    `Do you want to proceed with the copy operation?`,
    'Copy files to container',
    'Reject',
    true,
    options,
  );
  if (confirmation.answer) {
    putUserMessage(confirmation.answer);
  }

  if (!confirmation.confirmed) {
    putContainerLog('warn', 'Copy to container cancelled by user.', undefined, 'copy');
    putSystemMessage('Copy to container cancelled by user.');
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        text: `Do you want to proceed with the copy operation?`,
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: 'I reject the copy operation.' + confirmation.answer,
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
        text: `Do you want to proceed with the copy operation?`,
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        text: 'I approve the copy operation.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        functionResponses: [
          {
            name: actionResult.name,
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
            name: actionResult.name,
            call_id: actionResult.id || undefined,
            content: `Error: ${errorMessage}`,
          },
        ],
      },
    );
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
