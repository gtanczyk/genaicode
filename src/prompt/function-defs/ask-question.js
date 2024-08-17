/**
 * Function definition for askQuestion
 */
export const askQuestion = {
  name: 'askQuestion',
  description:
    'If there is a need ask a question to the user to gather more information or clarification. Alternatively this function can be called also if there is no need to prompt the user with any question.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The message you want to display to the user, it can be either a question or a confirmation/ackoweledgment in case there is no intention to prompt the user.',
      },
      shouldPrompt: {
        type: 'boolean',
        description: 'Set to true if the intention is to get response from the user.',
      },
      promptNecessity: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'How strong is the need to prompt the user? Higher value indicates a stronger need.',
      },
      stopCodegen: {
        type: 'boolean',
        description: 'If set to true, it will break the code generation process without error.',
      },
    },
    required: ['content', 'shouldPrompt', 'promptNecessity', 'stopCodegen'],
  },
};
