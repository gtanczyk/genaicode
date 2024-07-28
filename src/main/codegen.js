import { updateFiles } from '../files/update-files.js';
import { generateContent as generateContentGemini } from '../ai-service/vertex-ai.js';
import { dryRun, chatGpt, anthropic } from '../cli/cli-params.js';
import { validateCliParams } from '../cli/validate-cli-params.js';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';
import { generateContent as generateContentClaude } from '../ai-service/anthropic.js';
import { promptService } from '../prompt/prompt-service.js';

/** Executes codegen */
export async function runCodegen() {
  // Print to console the received parameters
  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);

  validateCliParams();

  console.log('Generating response');
  const functionCalls = await (anthropic
    ? promptService(generateContentClaude)
    : chatGpt
      ? promptService(generateContentGPT)
      : promptService(generateContentGemini));
  console.log('Received function calls:', functionCalls);

  if (dryRun) {
    console.log('Dry run mode, not updating files');
  } else {
    console.log('Update files');
    updateFiles(functionCalls);
    console.log('Done!');
  }
}
