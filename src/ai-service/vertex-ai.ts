import { GenerateContentFunction, GenerateContentResult, GenerateContentArgs } from './common-types.js';
import { internalGoogleGenerateContent } from './ai-studio.js';

/**
 * This function generates content using the Vertex AI Gemini models with the new interface.
 * It now delegates to a shared implementation in ai-studio.ts.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  const [prompt, config, options = {}] = args;
  try {
    return await internalGoogleGenerateContent('vertex-ai', prompt, config, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Google Cloud Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
