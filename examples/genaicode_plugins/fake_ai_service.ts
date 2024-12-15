import { GenerateContentArgs, FunctionCall, Plugin } from '../../src/index.js';

const fakeAiService: Plugin = {
  name: 'fake-ai-service',
  aiServices: {
    'fake-ai-service': {
      generateContent: async (...args: GenerateContentArgs): Promise<FunctionCall[]> => {
        console.log('FAKE AI SERVICE CALLED', ...args);
        return [];
      },
      serviceConfig: {},
    },
  },
  // Example implementation of generateContent hooks
  generateContentHook: async (args, result): Promise<void> => {
    const [, , , , , options] = args;
    if (options.aiService === 'plugin:fake-ai-service') {
      console.log('Nonsense Plugin - generateContent hook executed with args:', {
        args,
        result,
      });
    }
  },
};

export default fakeAiService;
