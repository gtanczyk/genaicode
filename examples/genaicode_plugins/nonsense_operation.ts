import { Plugin } from '../../src/index.js';

const fakeAiService: Plugin = {
  name: 'nonsense-operation',
  operations: {
    'nonsense-operation': {
      executor: async (args) => {
        console.log('NONSE OPERATION EXECUTED', args);
      },
      def: {
        name: 'nonsense',
        description: 'nonsense operation',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
          required: ['input'],
        },
      },
    },
  },
};

export default fakeAiService;
