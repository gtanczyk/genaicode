import { GenerateContentArgs, FunctionCall } from '../../src/ai-service/common';
import { Plugin } from '../../src/main/codegen-types';

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
