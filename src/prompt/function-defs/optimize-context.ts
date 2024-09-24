/**
 * Function definition for optimizeContext
 */
export const optimizeContext = {
  name: 'optimizeContext',
  description:
    'This function narrows the context of code genertion to the list of provided files. Those files are considered as relevant to the user prompt',
  parameters: {
    type: 'object',
    properties: {
      userPrompt: {
        type: 'string',
        description: "The user's original prompt.",
      },
      optimizedContext: {
        type: 'array',
        description: 'An array of absolute paths of files, which are considered as relevant to the user prompt.',
        items: {
          type: 'string',
          description: 'Array item is a absolute file path',
        },
      },
    },
    required: ['userPrompt', 'optimizedContext'],
  },
} as const;
