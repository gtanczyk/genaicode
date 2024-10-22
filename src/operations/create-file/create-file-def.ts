import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for createFile
 */
export const createFileDef: FunctionDef = {
  name: 'createFile',
  description:
    'Create a new file with specified content. The file will be created inside of project folder structure. This tool should not be used of creation if image files.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path of the file that will be created, it must not be empty.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind creating this file',
      },
      newContent: {
        type: 'string',
        description: 'Content of the file that will be created, it must no be empty.',
      },
    },
    required: ['filePath', 'newContent'],
  },
};

export type CreateFileArgs = {
  filePath: string;
  explanation?: string;
  newContent: string;
};