import { FunctionDef } from '../../ai-service/common-types.js';

export const pullConsoleLogs: FunctionDef = {
  name: 'pullConsoleLogs',
  description: 'Retrieves captured console logs from the application.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'The mode for retrieving logs.',
        enum: ['suffix', 'prefix', 'summary'],
      },
      prompt: {
        type: 'string',
        description: "An optional prompt to include when retrieving the logs. (for 'summary' mode)",
      },
      lines: {
        type: 'number',
        description: "Number of log lines to retrieve (for 'prefix' and 'suffix' modes).",
      },
      level: {
        type: 'string',
        description: 'Filter logs by a specific level.',
        enum: ['log', 'info', 'warn', 'error', 'debug', 'trace', 'assert'],
      },
    },
    required: ['mode'],
  },
};
