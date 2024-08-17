/**
 * Function definition for updateFile
 */
export const updateFile = {
  name: 'updateFile',
  description:
    'Update a file with new content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path to update.',
      },
      newContent: {
        type: 'string',
        description: 'The content to update the file with. Must not be empty.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind the suggested code changes for this file',
      },
    },
    required: ['filePath', 'newContent'],
  },
};
