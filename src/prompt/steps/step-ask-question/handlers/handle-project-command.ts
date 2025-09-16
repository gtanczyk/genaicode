import { exec } from 'child_process';
import { promisify } from 'util';
import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { rcConfig, getProjectCommand, getProjectCommands } from '../../../../main/config.js';
import {
  ActionHandlerProps,
  ActionResult,
  ProjectCommandResult,
  RunProjectCommandArgs,
} from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { FunctionCall, GenerateContentArgs, ModelType } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';

const execPromise = promisify(exec);

export async function handleRunProjectCommand({
  generateContentFn,
  askQuestionCall,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const runProjectCommandRequest: GenerateContentArgs = [
    prompt,
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'runProjectCommand',
      modelType: ModelType.CHEAP,
      temperature: 0.7,
      expectedResponseType: { text: false, functionCall: true, media: false },
    },
    options,
  ];
  const runProjectCommandResult = await generateContentFn(...runProjectCommandRequest);
  const RunProjectCommandCall = runProjectCommandResult
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall)
    .find((call) => call.name === 'runProjectCommand') as FunctionCall<RunProjectCommandArgs> | undefined;

  if (!RunProjectCommandCall?.args) {
    putSystemMessage('No runProjectCommand call found in the assistant response.');
    prompt.push(
      {
        type: 'assistant',
        functionCalls: [askQuestionCall],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'askQuestion',
            call_id: askQuestionCall.id,
            content: JSON.stringify({ error: 'No runProjectCommand call found in the assistant response.' }),
            isError: true,
          },
        ],
      },
    );
    return { breakLoop: true, items: [] };
  }

  const { name, args = [], env: envOverride, workingDirOverride } = RunProjectCommandCall.args;

  const command = getProjectCommand(name);

  if (!command) {
    const errorMessage = `Project command "${name}" not found. Available commands are: ${[
      ...getProjectCommands().keys(),
    ].join(', ')}`;
    putSystemMessage(errorMessage);
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
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

  const confirmation = await askUserForConfirmationWithAnswer(
    `Do you want to run the project command "${name}"?`,
    'Run command',
    'Reject',
    true,
    options,
  );

  if (confirmation.answer) {
    putUserMessage(confirmation.answer);
  }

  if (!confirmation.confirmed) {
    putSystemMessage(`Project command "${name}" cancelled by user.`);
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
        functionCalls: [
          { name: 'runProjectCommand', id: askQuestionCall.id + '_runProjectCommand', args: { name, args } },
        ],
      },
      {
        type: 'user',
        text:
          `I reject running the project command "${name}".` + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        functionResponses: [
          {
            name: 'runProjectCommand',
            call_id: askQuestionCall.id + '_runProjectCommand',
            content: JSON.stringify({ error: 'User rejected command execution.' }),
            isError: true,
          },
        ],
      },
    );
    return { breakLoop: true, items: [] };
  }

  const finalArgs = [...(command.defaultArgs || []), ...args];
  const fullCommand = [command.command, ...finalArgs].join(' ');
  const cwd = workingDirOverride || command.workingDir || rcConfig.rootDir;
  const env = { ...process.env, ...(command.env || {}), ...envOverride };

  putSystemMessage(`Executing project command "${name}": ${fullCommand}`, { cwd, env, args: finalArgs });

  let result: ProjectCommandResult;

  try {
    const { stdout, stderr } = await execPromise(fullCommand, { cwd, env });
    result = { success: true, exitCode: 0, stdout, stderr };
    putSystemMessage(`Project command "${name}" executed successfully.`, { stdout, stderr });
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
  };
}

registerActionHandler('runProjectCommand', handleRunProjectCommand);
