import { FunctionDef } from '../../ai-service/common-types';

export const readHistory: FunctionDef = {
  name: 'readHistory',
  description: 'This function reads the history from the cache and returns it as a string.',
  parameters: {
    type: 'object',
    properties: {
      dateTime: {
        type: 'string',
      },
    },
    required: [],
  },
};
