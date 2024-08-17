/**
 * Function definition for deleteFile
 */
export const deleteFile = {
  name: 'deleteFile',
  description: 'Delete a specified file from the application source code.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path to delete.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind deleting this file',
      },
    },
    required: ['filePath'],
  },
};
