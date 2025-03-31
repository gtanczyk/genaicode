import {
  GenerateContentArgs,
  FunctionCall,
  Plugin,
  GenerateContentNewFunction,
  GenerateContentResult,
  GenerateContentArgsNew,
} from '../../src/index.js';

/**
 * Mock implementation of generateContentNew for the fake AI service.
 */
const generateContentNew: GenerateContentNewFunction = async function generateContentNew(
  ...args: GenerateContentArgsNew
): Promise<GenerateContentResult> {
  console.log('FAKE AI SERVICE generateContentNew CALLED', ...args);
  return Promise.resolve([]);
};

const fakeAiService: Plugin = {
  name: 'fake-ai-service',
  aiServices: {
    'fake-ai-service': {
      generateContent: async (...args: GenerateContentArgs): Promise<FunctionCall[]> => {
        // Call the mock generateContentNew function with mapped parameters
        const [prompt, functionDefs, requiredFunctionName, temperature, modelType, options] = args;

        await generateContentNew(
          prompt,
          {
            modelType,
            temperature,
            functionDefs,
            requiredFunctionName,
            expectedResponseType: {
              text: false,
              functionCall: true,
              media: false,
            },
          },
          options || {},
        );

        console.log('FAKE AI SERVICE CALLED', ...args);
        return [];
      },
      generateContentNew,
      serviceConfig: {},
    },
  },
  // Example implementation of generateContent hooks
  generateContentHook: async (args, result): Promise<void> => {
    const [, , , , , options] = args;
    if (options?.aiService === 'plugin:fake-ai-service') {
      console.log('Nonsense Plugin - generateContent hook executed with args:', {
        args,
        result,
      });
    }
  },
};

export default fakeAiService;
