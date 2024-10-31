import { FunctionDef } from '../../ai-service/common';

export const askQuestionReflect: FunctionDef = {
  name: 'askQuestionReflect',
  description: 'This function is used to decide whether to escalate the request to more advanced model.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'The reason for the escalation necessity, clear and concise guidance on what should be improved.',
      },
      shouldEscalate: {
        type: 'number',
        description:
          'A number in range [0, 1] that expresses the escalation necessity: 0 - no need to escalate, 1 - absolutely need to escalate to more advanced model.',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['reason', 'shouldEscalate'],
  },
};
