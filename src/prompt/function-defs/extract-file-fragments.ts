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
      fragments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Explanation of why this fragment was selected.',
            },
            content: {
              type: 'string',
              description: 'The extracted fragment content.',
            },
            filePath: {
              type: 'string',
              description: 'The path of the file this fragment was extracted from.',
            },
          },
          required: ['reason', 'content', 'filePath'],
        },
        description: 'Array of extracted fragments with their locations and explanations.',
      },
    },
    required: ['fragments'],
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
