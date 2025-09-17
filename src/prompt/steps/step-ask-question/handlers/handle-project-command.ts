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
import { FunctionCall, GenerateContentArgs, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
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
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: JSON.stringify(rcConfig.projectCommands),
      },
    ],
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
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: 'No runProjectCommand call found in the assistant response.',
      },
    );
    return { breakLoop: true, items: [] };
  }

  const { name, args = [], env: envOverride, workingDirOverride, truncMode = 'summarize' } = RunProjectCommandCall.args;

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

  putSystemMessage(`Executing project command "${name}": ${fullCommand}`, {
    cwd,
    envOverride,
    args: finalArgs,
    truncMode,
    workingDirOverride,
  });

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

  // Handle output truncation
  if (truncMode === 'first') {
    result.stdout = truncateOutput(result.stdout, 'first');
    result.stderr = truncateOutput(result.stderr, 'first');
  } else if (truncMode === 'last') {
    result.stdout = truncateOutput(result.stdout, 'last');
    result.stderr = truncateOutput(result.stderr, 'last');
  } else if (truncMode === 'summarize') {
    if (result.stdout.length > 0) {
      result.stdout = await summarizeOutput(result.stdout, generateContentFn, options);
    }
    if (result.stderr.length > 0) {
      result.stderr = await summarizeOutput(result.stderr, generateContentFn, options);
    }
  }
  putSystemMessage(`Command output sent to AI`, {
    truncMode,
    stdout: result.stdout,
    stderr: result.stderr,
  });

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

const MAX_OUTPUT_LENGTH = 2000;
const TRUNCATE_LINES = 200;
const TRUNCATE_CHARS = 1000;

function truncateOutput(output: string, mode: 'first' | 'last'): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }

  const lines = output.split('\n');
  if (mode === 'first') {
    const truncatedLines = lines.slice(0, TRUNCATE_LINES).join('\n');
    return truncatedLines.length > TRUNCATE_CHARS ? truncatedLines.substring(0, TRUNCATE_CHARS) : truncatedLines;
  } else {
    // mode === 'last'
    const truncatedLines = lines.slice(-TRUNCATE_LINES).join('\n');
    return truncatedLines.length > TRUNCATE_CHARS
      ? truncatedLines.substring(truncatedLines.length - TRUNCATE_CHARS)
      : truncatedLines;
  }
}

async function summarizeOutput(
  output: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<string> {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  putSystemMessage('Summarizing command output...');
  const summaryPrompt: PromptItem[] = [
    {
      type: 'user',
      text: `Please summarize the following command output:\n\n---\n\n${output}`,
    },
  ];
  const summaryRequest: GenerateContentArgs = [
    summaryPrompt,
    {
      modelType: ModelType.LITE,
      expectedResponseType: { text: true, functionCall: false, media: false },
    },
    options,
  ];
  const summaryResult = await generateContentFn(...summaryRequest);
  const summaryText = summaryResult.find((part) => part.type === 'text')?.text;
  if (!summaryText) {
    putSystemMessage('Failed to summarize output, returning truncated version.');
    return truncateOutput(output, 'first');
  }
  return summaryText;
}

registerActionHandler('runProjectCommand', handleRunProjectCommand);
