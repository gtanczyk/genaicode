import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for deleteFile
 */
export const deleteFileDef: FunctionDef = {
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
};

export type DeleteFileArgs = {
  filePath: string;
  explanation?: string;
};
