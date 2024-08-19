/**
 * Function definition for createDirectory
 */
export const createDirectory = {
  name: 'createDirectory',
  description: 'Create a new directory',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The directory path to create.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind creating this directory',
      },
    },
    required: ['filePath'],
  },
} as const;
