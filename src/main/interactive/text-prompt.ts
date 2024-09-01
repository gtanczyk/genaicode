import { input } from '@inquirer/prompts';

export async function runTextPrompt(): Promise<string> {
  try {
    const prompt = await input({ message: 'Enter your text prompt:' });
    console.log(`Received prompt: ${prompt}`);
    return prompt;
  } catch (error) {
    console.error('Error getting text prompt:', error);
    throw error;
  }
}

// Helper function to validate the prompt
export function validatePrompt(prompt: string): boolean {
  return prompt.trim().length > 0;
}

// Helper function to sanitize the prompt
export function sanitizePrompt(prompt: string): string {
  return prompt.trim();
}

// Helper function to get a default prompt if needed
export async function getDefaultPrompt(): Promise<string> {
  try {
    return await input({
      message: 'No prompt provided. Enter a default prompt:',
      default: 'Please analyze the code and suggest improvements.',
    });
  } catch (error) {
    console.error('Error getting default prompt:', error);
    throw error;
  }
}
