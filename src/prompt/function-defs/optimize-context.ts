/**
 * Function definition for optimizeContext
 */
export const optimizeContext = {
  name: 'optimizeContext',
  description:
    'This function narrows the context of code generation to a list of relevant files, including their estimated token counts and relevance scores. It helps prioritize files based on their importance to the user prompt and manages token usage.',
  parameters: {
    type: 'object',
    properties: {
      userPrompt: {
        type: 'string',
        description: "The user's original prompt.",
      },
      optimizedContext: {
        type: 'array',
        description: 'An array of objects representing relevant files, their relevance scores, and token counts.',
        items: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'The absolute file path of a relevant file.',
            },
            relevance: {
              type: 'number',
              description: 'A score from 0 to 1 indicating the relevance of the file to the user prompt.',
              minimum: 0,
              maximum: 1,
            },
            tokenCount: {
              type: 'integer',
              description: 'The estimated token count for the file content.',
              minimum: 0,
            },
          },
          required: ['filePath', 'relevance', 'tokenCount'],
        },
      },
      totalTokenCount: {
        type: 'number',
        description: 'The estimated token count for the entire context.',
      },
    },
    required: ['userPrompt', 'optimizedContext', 'totalTokenCount'],
  },
} as const;
