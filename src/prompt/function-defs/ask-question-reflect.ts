import { FunctionDef } from '../../ai-service/common';

export const askQuestionReflect: FunctionDef = {
  name: 'askQuestionReflect',
  description:
    'This function is used to provide feedback on the quality and usefulness of the recent message from assistant.',
  parameters: {
    type: 'object',
    properties: {
      assessment: {
        type: 'string',
        description: 'Clear and concise guidance on what should be improved in the recent message from the assistant.',
      },
      qualityScore: {
        type: 'number',
        description:
          'A number in range [0, 1] that expresses the quality score of the recent message from the assistant. 0 means very quality, 1 means high quality. 0.5 means good enough.',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['assessment', 'qualityScore'],
  },
};
