/**
 * Function definition for explanation
 */
export const explanation = {
  name: 'explanation',
  description: 'Explain the reasoning behind the suggested code changes or reasoning for lack of code changes',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The explanation text',
      },
    },
    required: ['text'],
  },
};
