import { exec } from 'child_process';
import { promisify } from 'util';
import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { rcConfig } from '../../../../main/config.js';
import { ActionHandlerProps, ActionResult, ProjectCommandResult, RunBashCommandArgs } from '../step-iterate-types.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { FunctionCall, GenerateContentArgs, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';

const execPromise = promisify(exec);

export async function handleRunBashCommand({
  generateContentFn,
  iterateCall,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const runBashCommandRequest: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args?.message ?? '',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'runBashCommand',
      modelType: ModelType.CHEAP,
      temperature: 0.7,
      expectedResponseType: { text: false, functionCall: true, media: false },
    },
    options,
  ];
  const runBashCommandResult = await generateContentFn(...runBashCommandRequest);
  const runBashCommandCall = runBashCommandResult
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall)
    .find((call) => call.name === 'runBashCommand') as FunctionCall<RunBashCommandArgs> | undefined;

  if (!runBashCommandCall?.args) {
    putSystemMessage('No runBashCommand call found in the assistant response.');
    prompt.push(
      {
        type: 'assistant',
        text: iterateCall.args!.message,
      },
      {
        type: 'user',
        text: 'No runBashCommand call found in the assistant response.',
      },
    );
    return { breakLoop: false, items: [] };
  }

  const { command, env: envOverride, workingDirOverride, truncMode = 'summarize' } = runBashCommandCall.args;

  const confirmation = await askUserForConfirmationWithAnswer(
    `Do you want to run the bash command "${command}"?`,
    'Run command',
    'Reject',
    true,
    options,
  );

  if (confirmation.answer) {
    putUserMessage(confirmation.answer);
  }

  if (!confirmation.confirmed) {
    putSystemMessage(`Bash command "${command}" cancelled by user.`);
    prompt.push(
      {
        type: 'assistant',
        text: iterateCall.args!.message,
        functionCalls: [{ name: 'runBashCommand', id: iterateCall.id + '_runBashCommand', args: { command } }],
      },
      {
        type: 'user',
        text:
          `I reject running the bash command "${command}".` + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        functionResponses: [
          {
            name: 'runBashCommand',
            call_id: iterateCall.id + '_runBashCommand',
            content: JSON.stringify({ error: 'User rejected command execution.' }),
            isError: true,
          },
        ],
      },
    );
    return { breakLoop: false, items: [] };
  }

  const cwd = workingDirOverride || rcConfig.rootDir;
  const env = { ...process.env, ...envOverride };

  putSystemMessage(`Executing bash command: ${command}`, {
    cwd,
    envOverride,
    truncMode,
    workingDirOverride,
  });

  let result: ProjectCommandResult;

  try {
    const { stdout, stderr } = await execPromise(command, { cwd, env });
    result = { success: true, exitCode: 0, stdout, stderr };
    putSystemMessage(`Bash command executed successfully.`, { stdout, stderr });
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    result = {
      success: false,
      exitCode: code ?? 1,
      stdout,
      stderr,
    };
    putSystemMessage(`Bash command failed with exit code ${result.exitCode}.`, {
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
      functionCalls: [{ name: 'runBashCommand', id: iterateCall.id + '_runBashCommand', args: { command } }],
    },
    {
      type: 'user',
      text: `Command "${command}" finished with exit code ${result.exitCode}. Please analyze the output.`,
      functionResponses: [
        {
          name: 'runBashCommand',
          call_id: iterateCall.id + '_runBashCommand',
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

  const lines = output.split('\\n');
  if (mode === 'first') {
    const truncatedLines = lines.slice(0, TRUNCATE_LINES).join('\\n');
    return truncatedLines.length > TRUNCATE_CHARS ? truncatedLines.substring(0, TRUNCATE_CHARS) : truncatedLines;
  } else {
    // mode === 'last'
    const truncatedLines = lines.slice(-TRUNCATE_LINES).join('\\n');
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
      text: `Please summarize the following command output:\\n\\n---\\n\\n${output}`,
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

registerActionHandler('runBashCommand', handleRunBashCommand);
