import { FunctionDef } from '../../ai-service/common-types';

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
            dependencies: {
              type: 'array',
              description: 'Optional list of file dependencies detected in the source code.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Path to the dependent file or package/library name for external dependencies.',
                  },
                  type: {
                    type: 'string',
                    enum: ['local', 'external'],
                    description: 'Type of dependency - local (file in project) or external (package/library/module).',
                  },
                },
                required: ['path', 'type'],
              },
            },
          },
          required: ['filePath', 'summary', 'dependencies'],
        },
      },
    },
    required: ['summaries'],
  },
};
