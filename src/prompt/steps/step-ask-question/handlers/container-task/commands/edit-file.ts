import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { executeCommand, getFileContentFromContainer } from '../utils/docker-utils.js';
import * as diff from 'diff';

export const editFileDef: FunctionDef = {
  name: 'editFile',
  description:
    'Edit a text file inside the container. You can either provide the full new content or a patch in diff format.',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this file needs to be edited.',
      },
      filePath: {
        type: 'string',
        description: 'The absolute path to the file inside the container.',
      },
      newContent: {
        type: 'string',
        description: 'The full new content of the file. Use this for overwriting the file. Cannot be used with patch.',
      },
      patch: {
        type: 'string',
        description:
          'A patch in diff format to apply to the file. Use this for partial updates. Cannot be used with newContent.',
      },
    },
    required: ['reasoning', 'filePath'],
  },
};

export type EditFileArgs = {
  reasoning: string;
  filePath: string;
  newContent?: string;
  patch?: string;
};

export async function handleEditFile(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container } = props;
  const args = actionResult.args as EditFileArgs;
  const { reasoning, filePath, newContent, patch } = args;

  try {
    if (!newContent && !patch) {
      throw new Error('Either newContent or patch must be provided for editFile.');
    }
    if (newContent && patch) {
      throw new Error('Cannot provide both newContent and patch for editFile.');
    }

    putContainerLog('info', `Editing file: ${reasoning}`, args, 'command');

    let finalContent: string;

    if (patch) {
      const originalContent = await getFileContentFromContainer(container, filePath);
      const patchedContent = diff.applyPatch(originalContent, patch);

      if (patchedContent === false) {
        throw new Error(
          'Failed to apply patch. The patch may be invalid or not apply cleanly. Try providing the full file content instead.',
        );
      }
      finalContent = patchedContent;
    } else {
      finalContent = newContent!;
    }

    const { output, exitCode } = await executeCommand(container, '/bin/sh', `tee "${filePath}"`, finalContent, '/');
    if (exitCode !== 0) {
      throw new Error(`Failed to write to file: ${output}`);
    }
    const resultMessage = `File ${filePath} edited successfully.`;
    putContainerLog('info', resultMessage, { filePath, exitCode, output }, 'command');
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
            call_id: actionResult.id,
            content: resultMessage,
          },
        ],
      },
    );
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);
    putContainerLog('error', 'An error occurred while editing the file', { error: errMessage });
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
            call_id: actionResult.id,
            content: `File edit failed: ${errMessage}`,
          },
        ],
      },
    );
  }

  return { commandsExecutedIncrement: 1 };
}
