import { GenerateContentArgs, Plugin, GenerateContentFunction, GenerateContentResult } from '../../src/index.js';

/**
 * Mock implementation of generateContent for the fake AI service.
 */
const generateContent: GenerateContentFunction = async function generateContent(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  console.log('FAKE AI SERVICE generateContent CALLED', ...args);
  return Promise.resolve([]);
};

const fakeAiService: Plugin = {
  name: 'fake-ai-service',
  aiServices: {
    'fake-ai-service': {
      generateContent,
      serviceConfig: {},
    },
  },
  // Example implementation of generateContent hooks
  generateContentHook: async (args, result): Promise<void> => {
    const [, , options] = args;
    if (options?.aiService === 'plugin:fake-ai-service') {
      console.log('Nonsense Plugin - generateContent hook executed with args:', {
        args,
        result,
      });
    }
  },
};

export default fakeAiService;
