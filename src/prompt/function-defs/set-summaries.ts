import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for setSummaries
 */
export const setSummaries: FunctionDef = {
  name: 'setSummaries',
  description: 'Use this function to save summaries of files',
  parameters: {
    type: 'object',
    properties: {
      summaries: {
        type: 'array',
        description:
          'An array of results, each corresponding to an analyzed file, containing the absolute file path, and a brief summary.',
        items: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'The absolute file path of the analyzed file.',
            },
            summary: {
              type: 'string',
              description:
                "A summary of the file's content, highlighting its main purpose, functionality, or details which may be useful for context optimization.",
            },
          },
          required: ['filePath', 'summary'],
        },
      },
    },
    required: ['summaries'],
  },
};
