/**
 * Function definition for setSummaries
 */
export const setSummaries = {
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
            path: {
              type: 'string',
              description: 'The absolute file path of the analyzed file.',
            },
            summary: {
              type: 'string',
              description:
                "A concise one-sentence summary of the file's content, highlighting its main purpose or functionality. Maximum 10 tokens.",
            },
          },
          required: ['path', 'summary'],
        },
      },
    },
    required: ['summaries'],
  },
} as const;
