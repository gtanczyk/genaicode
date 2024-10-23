import { GenerateContentArgs, FunctionCall, Plugin } from '../../src/index.js';

const fakeAiService: Plugin = {
  name: 'fake-ai-service',
  aiServices: {
    'fake-ai-service': async (...args: GenerateContentArgs): Promise<FunctionCall[]> => {
      console.log('FAKE AI SERVICE CALLED', ...args);
      return [];
    },
  },
};

export default fakeAiService;
