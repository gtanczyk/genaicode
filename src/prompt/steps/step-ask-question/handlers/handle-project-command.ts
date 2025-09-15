import { exec } from 'child_process';
import { promisify } from 'util';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { rcConfig, getProjectCommand, getProjectCommands } from '../../../../main/config.js';
import {
  ActionHandlerProps,
  ActionResult,
  ProjectCommandResult,
  RunProjectCommandArgs,
} from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

const execPromise = promisify(exec);

export async function handleRunProjectCommand({ askQuestionCall, prompt }: ActionHandlerProps): Promise<ActionResult> {
  const {
    name,
    args = [],
    env: envOverride = {},
    workingDirOverride,
  } = (askQuestionCall.args ?? {}) as RunProjectCommandArgs;

  if (typeof name !== 'string') {
    // This should ideally be caught by schema validation
    throw new Error('`name` of the project command must be a string.');
  }

  const command = getProjectCommand(name);

  if (!command) {
    const errorMessage = `Project command "${name}" not found. Available commands are: ${[
      ...getProjectCommands().keys(),
    ].join(', ')}`;
    putSystemMessage(errorMessage);
    prompt.push(
      {
        type: 'assistant',
        functionCalls: [{ name: 'runProjectCommand', id: askQuestionCall.id + '_runProjectCommand', args: { name } }],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'runProjectCommand',
            call_id: askQuestionCall.id + '_runProjectCommand',
            content: JSON.stringify({ error: errorMessage }),
            isError: true,
          },
        ],
      },
    );
    return { breakLoop: false, items: [] };
  }

  const finalArgs = [...(command.defaultArgs || []), ...args];
  const fullCommand = [command.command, ...finalArgs].join(' ');
  const cwd = workingDirOverride || command.workingDir || rcConfig.rootDir;
  const env = { ...process.env, ...(command.env || {}), ...envOverride };

  putSystemMessage(`Executing project command "${name}": ${fullCommand}`);

  let result: ProjectCommandResult;

  try {
    const { stdout, stderr } = await execPromise(fullCommand, { cwd, env });
    result = { success: true, exitCode: 0, stdout, stderr };
    putSystemMessage(`Project command "${name}" executed successfully.`);
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    result = {
      success: false,
      exitCode: code ?? 1,
      stdout,
      stderr,
    };
    putSystemMessage(`Project command "${name}" failed with exit code ${result.exitCode}.`, {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  prompt.push(
    {
      type: 'assistant',
      functionCalls: [
        { name: 'runProjectCommand', id: askQuestionCall.id + '_runProjectCommand', args: { name, args } },
      ],
    },
    {
      type: 'user',
      text: `Command "${name}" finished with exit code ${result.exitCode}. Please analyze the output.`,
      functionResponses: [
        {
          name: 'runProjectCommand',
          call_id: askQuestionCall.id + '_runProjectCommand',
          content: JSON.stringify(result),
        },
      ],
    },
  );

  return {
    breakLoop: false,
    items: [],
    projectCommandResult: result,
  };
}

registerActionHandler('runProjectCommand', handleRunProjectCommand);
