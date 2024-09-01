import { input } from '@inquirer/prompts';
import { CodegenOptions } from '../codegen-types.js';
import { runCodegenWorker } from './codegen-worker.js';

export async function runTextPrompt(options: CodegenOptions): Promise<void> {
  try {
    const prompt = await input({
      message: 'Enter your text prompt:',
    });

    console.log(`Received prompt: ${prompt}`);
    if (prompt) {
      await runCodegenWorker({ ...options, explicitPrompt: prompt, considerAllFiles: true });
    }
  } catch (error) {
    console.error('Error getting text prompt:', error);
    throw error;
  }
}
