export const askQuestionReflect = {
  name: 'askQuestionReflect',
  description: 'This function is used to decide whether to escalate the request to more advanced model.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'The reason for the escalation necessity.',
      },
      shouldEscalate: {
        type: 'number',
        description:
          'A number that expresses the escalation necessity: 0 - no need to escalate, 100 - absolutely need to escalate to more advanced model.',
        minimum: 0,
        maximum: 100,
      },
    },
    required: ['reason', 'shouldEscalate'],
  },
} as const;
