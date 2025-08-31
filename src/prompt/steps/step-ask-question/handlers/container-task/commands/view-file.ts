import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { getFileContentFromContainer, executeCommand } from '../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';

export const viewFileDef: FunctionDef = {
  name: 'viewFile',
  description:
    'View a text file or list directory contents inside the container. You can view the full file or a specific range of lines.',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this path needs to be viewed.',
      },
      filePath: {
        type: 'string',
        description: 'The absolute path to the file or directory inside the container.',
      },
      startLine: {
        type: 'number',
        description: 'The starting line number to view (1-indexed). Only applicable for files.',
      },
      endLine: {
        type: 'number',
        description: 'The ending line number to view (1-indexed). Only applicable for files.',
      },
    },
    required: ['reasoning', 'filePath'],
  },
};

export type ViewFileArgs = {
  reasoning: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export async function handleViewFile(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container } = props;
  const args = actionResult.args as ViewFileArgs;
  const { reasoning, filePath, startLine, endLine } = args;

  putContainerLog('info', `Viewing path: ${reasoning}`, args, 'command');

  try {
    const dirCheck = await executeCommand(container, '/bin/sh', `test -d "${filePath}"`, '', '/');
    let finalContent: string;

    if (dirCheck.exitCode === 0) {
      if (startLine || endLine) {
        throw new Error('startLine and endLine parameters are not applicable for directories.');
      }
      const { output, exitCode } = await executeCommand(container, '/bin/sh', `ls -la "${filePath}"`, '', '/');
      if (exitCode !== 0) {
        throw new Error(`Failed to list directory contents for ${filePath}: ${output}`);
      }
      finalContent = `Directory listing for ${filePath}:\n\n${output}`;
      putContainerLog('info', `Successfully listed directory ${filePath}`, { filePath }, 'command');
    } else {
      let content = await getFileContentFromContainer(container, filePath);
      const lines = content.split('\n');
      let resultMessage = `File content of ${filePath}:\n\n`;

      if (startLine || endLine) {
        const start = startLine ? startLine - 1 : 0;
        const end = endLine ? endLine : lines.length;
        const slicedLines = lines.slice(start, end);
        content = slicedLines.join('\n');
        resultMessage = `File content of ${filePath} from line ${startLine || 1} to ${endLine || lines.length}:\n\n`;
      }
      finalContent = resultMessage + content;
      putContainerLog('info', `Successfully viewed file ${filePath}`, { filePath }, 'command');
    }

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
            content: finalContent,
          },
        ],
      },
    );
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);
    putContainerLog('error', 'An error occurred while viewing the path', { error: errMessage });
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
            content: `View path failed: ${errMessage}`,
          },
        ],
      },
    );
  }

  return { commandsExecutedIncrement: 1 };
}
