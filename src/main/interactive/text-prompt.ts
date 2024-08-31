import { input } from '@inquirer/prompts';
import { runCodegenIteration } from '../codegen.js';
import { CodegenOptions } from '../codegen-types.js';

export async function runTextPrompt(options: CodegenOptions) {
  const prompt = await input({ message: 'Enter your text prompt:' });
  console.log(`Executing prompt: ${prompt}`);
  await runCodegenIteration({ ...options, explicitPrompt: prompt });
}
