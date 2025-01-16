import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for updateFile
 */
export const updateFileDef: FunctionDef = {
  name: 'updateFile',
  description: `Update a file with new content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.
CAUTION: This function may not work well for large/long files due to output token limit (8000 tokens).`,
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path to update.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind the suggested code changes for this file',
      },
      newContent: {
        type: 'string',
        description: 'The content to update the file with. Must not be empty.',
      },
    },
    required: ['filePath', 'newContent'],
  },
};

export type UpdateFileArgs = {
  filePath: string;
  explanation?: string;
  newContent: string;
};
