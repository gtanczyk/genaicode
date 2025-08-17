import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { executeCommand } from '../../../../../../utils/docker-utils.js';
import { RunCommandArgs } from '../container-task-types.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const runCommandDef: FunctionDef = {
  name: 'runCommand',
  description: `Execute a shell command in the Docker container.
IMPORTANT: 
- The command will block you until it completes, so consider using a non-blocking approach if needed.
- For complex/long input you should prefer \`stdin\` over command-line arguments. For example instead of echo \`some long text\`, you can put the long text in the \`stdin\` field, and then use it in the command like this: \`cat | some_command\`.
  `,
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this command is needed for the task.',
      },
      command: {
        type: 'string',
        description:
          'The shell command to execute in the container. Command must be 256 characters or less. If there is a need for a longer command, consider using a script file, and consider using `stdin` to pass the script contents.',
        maxLength: 256,
      },
      stdin: {
        type: 'string',
        description:
          'Input to provide to the command via stdin. Equivalent of `echo <stdin> | <command>`. Very good for long inputs, better than passing as command-line arguments in the command string parameter.',
      },
      truncMode: {
        type: 'string',
        description: 'Mode for truncating command output (e.g., "start", "end").',
        enum: ['start', 'end'],
      },
      workingDir: {
        type: 'string',
        description: 'Working directory inside the container to run the command in. This MUST be an absolute path.',
        minLength: 1,
      },
    },
    required: ['reasoning', 'command', 'stdin', 'workingDir', 'truncMode'],
  },
};

export interface HandleRunCommandProps extends CommandHandlerBaseProps {
  maxOutputLength: number;
}

export async function handleRunCommand(props: HandleRunCommandProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container, maxOutputLength } = props;
  const args = actionResult.args as RunCommandArgs;
  const { command, workingDir, reasoning, stdin, truncMode } = args;

  putSystemMessage(`💿 Executing command: ${reasoning}`, args);

  const { output, exitCode } = await executeCommand(container, command, stdin, workingDir);

  let managedOutput = output;
  if (output.length > maxOutputLength) {
    if (truncMode === 'start') {
      managedOutput = output.slice(0, maxOutputLength) + '\\n\\n[... output truncated for context management ...]';
    } else {
      managedOutput = '[... output truncated for context management ...]' + output.slice(-maxOutputLength);
    }
    putSystemMessage(`⚠️ Command output truncated (${output.length} -> ${managedOutput.length} chars)`);
  }

  putSystemMessage('Command executed', { managedOutput, exitCode });

  taskExecutionPrompt.push(
    {
      type: 'assistant',
      text: `Executing command with reasoning: ${reasoning}`,
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: 'runCommand',
          call_id: actionResult.id || undefined,
          content: `Command executed successfully.\\n\\nOutput:\\n${managedOutput}\\n\\nExit Code: ${exitCode}`,
        },
      ],
    },
  );

  return { shouldBreakOuter: false, commandsExecutedIncrement: 1 };
}
