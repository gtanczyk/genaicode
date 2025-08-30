import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { executeCommand } from '../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { abortController as globalAbortController } from '../../../../../../main/common/abort-controller.js';
import { onInterruptRequested } from './interrupt-controller.js';

export const runCommandDef: FunctionDef = {
  name: 'runCommand',
  description: `Execute a shell command in the Docker container in non-interactive mode using docker exec. It will do equivalent of /bin/bash -c "command" (or /bin/sh -c "command").
IMPORTANT: 
- The shell by default is using /bin/sh - take this into account when running commands.
- The command will block you until it completes, so consider using a non-blocking approach if needed.
- Ensure you are going to run command in non interactive mode, so that it will not block waiting for input, which will not come.
- For complex/long input you should prefer \`stdin\` over command-line arguments. For example instead of echo \`some long text\`, you can put the long text in the \`stdin\` field, and then use it in the command like this: \`cat | some_command\`.
- State of shell is not persistent across commands, so you need to set up the environment each time (think how to do it effectively).
  `,
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this command is needed for the task.',
      },
      shell: {
        type: 'string',
        description:
          'The shell to use for executing the command. CAUTION: some docker images do not have bash pre-installed! Bash should be the preferred shell.',
        enum: ['bash', '/bin/sh'],
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
        description:
          'Mode for truncating command output (e.g., "start", "end"). "none" means no truncation will be applied. "none" should be used only when you are sure the output will be rather short.',
        enum: ['start', 'end', 'none'],
      },
      timeout: {
        type: 'string',
        description: 'How long to wait for the command to complete.',
        enum: ['10sec', '30sec', '1min', '2min', '5min', '10min', '15min'],
      },
      workingDir: {
        type: 'string',
        description:
          'Working directory (ALREADY EXISTING) inside the container to run the command in. This MUST be an absolute path.',
        minLength: 1,
      },
    },
    required: ['reasoning', 'shell', 'command', 'stdin', 'workingDir', 'truncMode', 'timeout'],
  },
};

export interface HandleRunCommandProps extends CommandHandlerBaseProps {
  maxOutputLength: number;
}

type RunCommandArgs = {
  shell: '/bin/sh' | '/bin/bash';
  command: string;
  stdin?: string;
  truncMode: 'start' | 'end' | 'none';
  timeout: '10sec' | '30sec' | '1min' | '2min' | '5min' | '10min' | '15min';
  workingDir: string;
  reasoning: string;
};

export async function handleRunCommand(props: HandleRunCommandProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container, maxOutputLength } = props;
  const args = actionResult.args as RunCommandArgs;
  const { shell, command, workingDir, reasoning, stdin, truncMode, timeout } = args;

  putContainerLog('info', `Executing command: ${reasoning}`, args, 'command');

  const localController = new AbortController();
  const onGlobalAbort = () => localController.abort();
  globalAbortController?.signal.addEventListener('abort', onGlobalAbort);
  let abortTimeout;
  let output: string = '';
  let exitCode: number = 0;
  const clearInterruptListener = onInterruptRequested(() => localController.abort());
  try {
    const timeoutSeconds = parseTimeout(timeout);
    abortTimeout = setTimeout(() => localController.abort(), timeoutSeconds * 1000);
    const result = await executeCommand(container, shell, command, stdin, workingDir, localController.signal);
    output = result.output;
    exitCode = result.exitCode;
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);
    putContainerLog('error', 'An error occurred while executing the command', { error: errMessage });
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
            content: `Command execution failed: ${errMessage}`,
          },
        ],
      },
    );
    return { shouldBreakOuter: false, commandsExecutedIncrement: 1 };
  } finally {
    clearTimeout(abortTimeout);
    globalAbortController?.signal.removeEventListener('abort', onGlobalAbort);
    clearInterruptListener();
  }

  let managedOutput = output;
  if (output.length > maxOutputLength) {
    if (truncMode === 'start') {
      managedOutput = output.slice(0, maxOutputLength) + '\n\n[... output truncated for context management ...]';
    } else if (truncMode === 'end') {
      managedOutput = '[... output truncated for context management ...]' + output.slice(-maxOutputLength);
    }
    if (truncMode !== 'none') {
      putContainerLog('warn', `Command output truncated (${output.length} -> ${managedOutput.length} chars)`);
    }
  }

  putContainerLog('info', 'Command executed', { command, managedOutput, exitCode }, 'command');

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
          content: `Command executed successfully.\n\nOutput:\n${managedOutput}\n\nExit Code: ${exitCode}`,
        },
      ],
    },
  );

  return { shouldBreakOuter: false, commandsExecutedIncrement: 1 };
}

// Parse timeout values
function parseTimeout(timeout: RunCommandArgs['timeout']): number {
  switch (timeout) {
    case '10sec':
      return 10;
    case '30sec':
      return 30;
    case '1min':
      return 60;
    case '2min':
      return 120;
    case '5min':
      return 300;
    case '10min':
      return 600;
    case '15min':
      return 900;
    default:
      throw new Error(`Unknown timeout value: ${timeout}`);
  }
}
