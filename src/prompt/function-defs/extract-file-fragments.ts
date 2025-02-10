import { FunctionDef } from '../../ai-service/common-types';

/**
 * Response from extractFileFragments function
 */
export const extractFileFragments: FunctionDef = {
  name: 'extractFileFragments',
  description: 'Response containing extracted fragments from a file.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The path of the file that was processed.',
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
          },
          required: ['content', 'reason'],
        },
        description: 'Array of extracted fragments with their locations and explanations.',
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of how the fragments were selected and why they are relevant.',
      },
    },
    required: ['filePath', 'fragments', 'reasoning'],
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
};

/**
 * Response from extractFileFragments function
 */
export type ExtractFileFragmentsArgs = {
  /** The path of the file that was processed */
  filePath: string;
  /** Array of extracted fragments with their locations and explanations */
  fragments: FileFragment[];
  /** Explanation of how the fragments were selected and why they are relevant */
  reasoning: string;
};
