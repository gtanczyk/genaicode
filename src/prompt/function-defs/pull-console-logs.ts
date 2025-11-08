import { FunctionDef } from '../../ai-service/common-types.js';

export const pullConsoleLogs: FunctionDef = {
  name: 'pullConsoleLogs',
  description:
    'Retrieves captured console logs from the connected Vite frontend application. Only available when running with the vite-genaicode plugin.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'The mode for retrieving logs.',
        enum: ['suffix', 'prefix', 'full', 'summary'],
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
