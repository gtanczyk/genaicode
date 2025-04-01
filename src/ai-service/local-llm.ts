import OpenAI from 'openai';
import assert from 'node:assert';
import { GenerateContentArgs, GenerateContentFunction, GenerateContentResult } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { ModelType } from './common-types.js';
import { getServiceConfig } from './service-configurations.js';
import { internalGenerateContent } from './openai.js'; // Import the exported function

/**
 * This function generates content using the local llm service.
 * Local llm provides an OpenAI-compatible API, so we can reuse the OpenAI implementation.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  const [prompt, { modelType, temperature, functionDefs, requiredFunctionName }] = args;

  try {
    const serviceConfig = getServiceConfig('local-llm');

    const apiKey = serviceConfig?.apiKey || 'local-llm'; // Use configured or default key
    const baseURL = serviceConfig?.openaiBaseUrl || 'http://localhost:11434/v1/'; // Use configured or default URL

    assert(baseURL, 'Local llm base URL not configured, use LOCAL_LLM_BASE_URL environment variable.');

    // Create OpenAI client instance configured for the local LLM service
    const openai = new OpenAI({
      apiKey,
      baseURL,
    });

    // Determine the model name based on ModelType and service configuration
    const model = (() => {
      switch (modelType) {
        case ModelType.CHEAP:
          return serviceConfig.modelOverrides?.cheap ?? 'gemma3:12b';
        case ModelType.REASONING:
          // Local LLM doesn't have a standard reasoning model, fallback to default
          console.warn('Reasoning model type requested for local-llm, falling back to default model.');
          return serviceConfig.modelOverrides?.default ?? 'gemma3:12b';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gemma3:12b';
      }
    })();

    console.log(`Using local model: ${model}`);

    // Map arguments from GenerateContentArgs to GenerateContentArgsNew
    const config: GenerateContentArgs[1] = {
      modelType,
      temperature,
      functionDefs,
      requiredFunctionName,
      expectedResponseType: { functionCall: true, text: false, media: false }, // Old interface expects only function calls
    };

    // Add a nudge for required function name if necessary (specific to local-llm behavior)
    const adjustedPrompt = [...prompt];
    if (requiredFunctionName) {
      adjustedPrompt.push({
        type: 'user',
        text: `Call the \`${requiredFunctionName}\` function`,
      });
    }

    // Call the imported internalGenerateContent function with 'local-llm' as serviceType
    const result: GenerateContentResult = await internalGenerateContent(
      adjustedPrompt.map((item) => ({ ...item, text: item.text ?? ' ' })), // Ensure text isn't undefined
      config,
      model,
      openai,
      'local-llm', // Pass the correct service type to ensure proper model settings lookup
    );

    // Adapt the GenerateContentResult back to FunctionCall[] for backward compatibility
    const functionCalls: FunctionCall[] = result
      .filter((part): part is { type: 'functionCall'; functionCall: FunctionCall } => part.type === 'functionCall')
      .map((part) => part.functionCall);

    return functionCalls.map((call) => ({
      type: 'functionCall',
      functionCall: call,
    }));
  } catch (error) {
    if (error instanceof Error && error.message.includes('base URL not configured')) {
      throw new Error('Local base URL not configured. Please set up the service configuration.');
    }
    // Add specific error handling for local LLM connection issues
    if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
      const serviceConfig = getServiceConfig('local-llm');
      const baseURL = serviceConfig?.openaiBaseUrl || 'http://localhost:11434/v1/';
      throw new Error(
        `Failed to connect to local LLM at ${baseURL}. Please ensure the service is running and accessible.`,
      );
    }
    throw error;
  }
};
