import { FunctionDef } from '../../ai-service/common-types';

export const conversationSummaryDef: FunctionDef = {
  name: 'conversationSummary',
  description: 'Summarize the conversation and provide a title.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'A short title for the conversation.',
      },
    },
    required: ['title'],
  },
};
