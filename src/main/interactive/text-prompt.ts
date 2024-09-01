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
