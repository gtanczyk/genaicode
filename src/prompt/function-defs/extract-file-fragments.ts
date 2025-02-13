import { FunctionDef } from '../../ai-service/common-types';

/**
 * Response from extractFileFragments function
 */
export const extractFileFragments: FunctionDef = {
  name: 'extractFileFragments',
  description: 'Response containing extracted fragments from one or more files.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Array of file paths that were processed.',
      },
      fragments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The extracted fragment content.',
            },
            reason: {
              type: 'string',
              description: 'Explanation of why this fragment was selected.',
            },
            filePath: {
              type: 'string',
              description: 'The path of the file this fragment was extracted from.',
            },
          },
          required: ['content', 'reason', 'filePath'],
        },
        description: 'Array of extracted fragments with their locations and explanations.',
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of how the fragments were selected and why they are relevant.',
      },
    },
    required: ['filePaths', 'fragments', 'reasoning'],
  },
};

/**
 * Structure representing a fragment extracted from a file
 */
export type FileFragment = {
  /** The extracted fragment content */
  content: string;
  /** Explanation of why this fragment was selected */
  reason: string;
  /** The path of the file this fragment was extracted from */
  filePath: string;
};

/**
 * Response from extractFileFragments function
 */
export type ExtractFileFragmentsArgs = {
  /** Array of file paths that were processed */
  filePaths: string[];
  /** Array of extracted fragments with their locations and explanations */
  fragments: FileFragment[];
  /** Explanation of how the fragments were selected and why they are relevant */
  reasoning: string;
};
