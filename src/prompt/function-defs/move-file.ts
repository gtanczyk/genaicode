/**
 * Function definition for moveFile
 */
export const moveFile = {
  name: 'moveFile',
  description: 'Move a file from one location to another',
  parameters: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind moving this file',
      },
      source: {
        type: 'string',
        description: 'The current file path.',
      },
      destination: {
        type: 'string',
        description: 'The new file path.',
      },
    },
    required: ['source', 'destination'],
  },
} as const;
