import {
  GenerateContentArgs,
  GenerateContentFunction,
  FunctionCall,
  ModelType,
  PromptItem,
} from '../../../../ai-service/common-types.js';
import { getContextValue } from '../../../../main/common/app-context-bus.js';
import { ConsoleLogEntry } from '../../../../main/common/console-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult, AskQuestionCall, PullConsoleLogsArgs } from '../step-ask-question-types.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

const MAX_OUTPUT_LENGTH = 2000;

registerActionHandler('pullConsoleLogs', handlePullConsoleLogs);

export async function handlePullConsoleLogs({
  askQuestionCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const pullConsoleLogsCall = await generatePullConsoleLogsCall(
    generateContentFn,
    prompt,
    askQuestionCall,
    options,
    ModelType.CHEAP,
  );

  putSystemMessage('Retrieving console logs', { ...pullConsoleLogsCall?.args });

  if (!pullConsoleLogsCall?.args) {
    return {
      breakLoop: false,
      items: [],
    };
  }

  const { mode, lines = 20, level, prompt: summaryPrompt } = pullConsoleLogsCall.args;

  const logs = await getContextValue<ConsoleLogEntry[]>('__console_logs');

  if (!logs || logs.length === 0) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'I will retrieve the console logs.',
            functionCalls: [pullConsoleLogsCall],
          },
          user: {
            type: 'user',
            functionResponses: [
              {
                name: 'pullConsoleLogs',
                call_id: pullConsoleLogsCall.id,
                content: 'No console logs have been captured from the application.',
              },
            ],
          },
        },
      ],
    };
  }

  let filteredLogs = logs;
  if (level) {
    filteredLogs = logs.filter((log) => log.level === level);
  }

  if (filteredLogs.length === 0) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `I will retrieve the console logs with level '${level}'.`,
            functionCalls: [pullConsoleLogsCall],
          },
          user: {
            type: 'user',
            functionResponses: [
              {
                name: 'pullConsoleLogs',
                call_id: pullConsoleLogsCall.id,
                content: `No console logs found with level '${level}'.`,
              },
            ],
          },
        },
      ],
    };
  }

  let content = '';

  switch (mode) {
    case 'prefix':
      content = filteredLogs.slice(0, lines).map(formatLogEntry).join('\n');
      break;

    case 'suffix':
      content = filteredLogs.slice(-lines).map(formatLogEntry).join('\n');
      break;

    case 'summary': {
      const allLogs = filteredLogs.map(formatLogEntry).join('\n');
      content = await summarizeConsoleLogs(allLogs, summaryPrompt, generateContentFn, options);
      break;
    }
  }

  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: `I will retrieve the console logs (mode: ${mode}).`,
          functionCalls: [pullConsoleLogsCall],
        },
        user: {
          type: 'user',
          functionResponses: [
            {
              name: 'pullConsoleLogs',
              call_id: pullConsoleLogsCall.id,
              content: content || 'No logs to display with the given criteria.',
            },
          ],
        },
      },
    ],
  };
}

function formatLogEntry(entry: ConsoleLogEntry): string {
  const date = new Date(entry.timestamp).toISOString();
  return `[${date}] [${entry.level.toUpperCase()}] ${entry.message}`;
}

async function generatePullConsoleLogsCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  askQuestionCall: AskQuestionCall,
  options: CodegenOptions,
  modelType: ModelType,
): Promise<FunctionCall<PullConsoleLogsArgs> | undefined> {
  const req: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? 'I need to check the console logs.',
      },
      {
        type: 'user',
        text: 'Yes, you can pull the console logs.',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'pullConsoleLogs',
      temperature: 0.7,
      modelType,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];
  const [pullConsoleLogsCall] = (await generateContentFn(...req))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<PullConsoleLogsArgs> | undefined];

  return pullConsoleLogsCall;
}

async function summarizeConsoleLogs(
  logs: string,
  prompt: string | undefined,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<string> {
  if (logs.length <= MAX_OUTPUT_LENGTH) {
    return logs;
  }
  const summaryPrompt: PromptItem[] = [
    {
      type: 'user',
      text: `Please summarize the following console logs:\n\n---\n\n<logs>${logs}</logs>`,
    },
  ];
  if (prompt) {
    summaryPrompt[0].text += `\n\nAdditional instructions: ${prompt}`;
  }
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
    putSystemMessage('Failed to summarize console logs, returning truncated version.');
    // Return first MAX_OUTPUT_LENGTH characters as fallback
    return logs.substring(0, MAX_OUTPUT_LENGTH);
  }
  putSystemMessage('Console logs summarized successfully.', { summaryText });
  return summaryText;
}
