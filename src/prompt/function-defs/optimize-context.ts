/**
 * Function definition for optimizeContext
 */
export const optimizeContext = {
  name: 'optimizeContext',
  description:
    "Analyzes each file to provide a brief summary and rate its relevance to the user's prompt on a scale of 0 to 1.",
  parameters: {
    type: 'object',
    properties: {
      optimizedContext: {
        type: 'array',
        description:
          'An array of results, each corresponding to an analyzed file, containing the file path, a brief summary, and a relevance score.',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: "The file path of the analyzed file, matching the 'path' provided in the input.",
            },
            summary: {
              type: 'string',
              description:
                "A concise one-sentence summary of the file's content, highlighting its main purpose or functionality.",
            },
            relevance: {
              type: 'number',
              description:
                "A numeric score between 0 and 1 indicating the file's relevance to the user's prompt. A score of 0 means not relevant at all, while a score of 1 means highly relevant.",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ['path', 'summary', 'relevance'],
        },
      },
    },
    required: ['optimizedContext'],
  },
} as const;
