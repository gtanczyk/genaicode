import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for moveFile
 */
export const moveFileDef: FunctionDef = {
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
};

export type MoveFileArgs = {
  source: string;
  destination: string;
  explanation?: string;
};
