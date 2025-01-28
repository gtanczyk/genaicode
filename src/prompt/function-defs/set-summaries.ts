import { FunctionDef } from '../../ai-service/common-types.js';

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
                  type: {
                    type: 'string',
                    enum: ['local', 'external'],
                    description:
                      'Type of dependency - local (belongs to the project) or external (not belongs to the project, package/library/module).',
                  },
                  fileId: {
                    type: 'string',
                    description:
                      'Unique identifier for the dependent file. For local dependencies, use the value for the fileId field in the getSourceCode function response. Use empty string for external dependencies.',
                  },
                  path: {
                    type: 'string',
                    description:
                      'Absolute path to the dependent file or package/library name for external dependencies.',
                  },
                },
                required: ['type', 'fileId', 'path'],
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
