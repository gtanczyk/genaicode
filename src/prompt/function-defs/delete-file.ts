/**
 * Function definition for deleteFile
 */
export const deleteFile = {
  name: 'deleteFile',
  description: 'Delete a specified file from the application source code.',
  parameters: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind deleting this file',
      },
      filePath: {
        type: 'string',
        description: 'The file path to delete.',
      },
    },
    required: ['filePath'],
  },
} as const;
