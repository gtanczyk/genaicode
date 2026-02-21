import { GenerateContentFunction, GenerateContentResult, ModelType, PromptItem, FunctionDef } from './common-types.js';
import { internalGoogleGenerateContent } from './ai-studio.js';

/**
 * This function generates content using the Vertex AI Gemini models with the new interface.
 * It now delegates to a shared implementation in ai-studio.ts.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  config: {
    modelType?: ModelType;
    temperature?: number;
    functionDefs?: FunctionDef[];
    requiredFunctionName?: string | null;
    expectedResponseType?: {
      text?: boolean;
      functionCall?: boolean;
      media?: boolean;
      webSearch?: boolean;
      codeExecution?: boolean;
    };
  },
  options: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  } = {},
): Promise<GenerateContentResult> {
  try {
    return await internalGoogleGenerateContent('vertex-ai', prompt, config, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Google Cloud Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
