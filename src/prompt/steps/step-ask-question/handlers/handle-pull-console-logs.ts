import { getContextValue } from '../../../../main/common/app-context-bus.js';
import { ConsoleLogEntry, ConsoleLogLevel } from '../../../../main/common/console-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult, PullConsoleLogsArgs } from '../step-ask-question-types.js';

function formatLogEntry(entry: ConsoleLogEntry): string {
  const date = new Date(entry.timestamp).toISOString();
  return `[${date}] [${entry.level.toUpperCase()}] ${entry.message}`;
}

registerActionHandler('pullConsoleLogs', handlePullConsoleLogs);

export async function handlePullConsoleLogs({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const { mode, lines = 20, level } = askQuestionCall.args as PullConsoleLogsArgs;

  const logs = await getContextValue<ConsoleLogEntry[]>('__console_logs');

  if (!logs || logs.length === 0) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'I will retrieve the console logs.',
          },
          user: {
            type: 'user',
            functionResponses: [
              {
                name: 'pullConsoleLogs',
                call_id: askQuestionCall.id,
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
          },
          user: {
            type: 'user',
            functionResponses: [
              {
                name: 'pullConsoleLogs',
                call_id: askQuestionCall.id,
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
    case 'full':
      content = filteredLogs.map(formatLogEntry).join('\n');
      break;

    case 'prefix':
      content = filteredLogs.slice(0, lines).map(formatLogEntry).join('\n');
      break;

    case 'suffix':
      content = filteredLogs.slice(-lines).map(formatLogEntry).join('\n');
      break;

    case 'summary': {
      const summary: Record<ConsoleLogLevel, number> = {
        log: 0,
        info: 0,
        warn: 0,
        error: 0,
        debug: 0,
        trace: 0,
        assert: 0,
      };
      for (const log of filteredLogs) {
        summary[log.level]++;
      }
      const summaryParts = Object.entries(summary)
        .filter(([, count]) => count > 0)
        .map(([logLevel, count]) => `${logLevel}: ${count}`)
        .join(', ');

      const firstLog = formatLogEntry(filteredLogs[0]);
      const lastLog = formatLogEntry(filteredLogs[filteredLogs.length - 1]);

      content = `Console Log Summary (Total: ${filteredLogs.length}):\n${summaryParts}\n\nFirst log:\n${firstLog}\n\nLast log:\n${lastLog}`;
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
        },
        user: {
          type: 'user',
          functionResponses: [
            {
              name: 'pullConsoleLogs',
              call_id: askQuestionCall.id,
              content: content || 'No logs to display with the given criteria.',
            },
          ],
        },
      },
    ],
  };
}
