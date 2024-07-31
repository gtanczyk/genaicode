import assert from 'node:assert';

import { dryRun, chatGpt, anthropic, vertexAi, vertexAiClaude } from '../cli/cli-params.js';
import { validateCliParams } from '../cli/validate-cli-params.js';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';
import { promptService } from '../prompt/prompt-service.js';
import { updateFiles } from '../files/update-files.js';

/** Executes codegen */
export async function runCodegen() {
  // Print to console the received parameters
  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);

  validateCliParams();

  console.log('Generating response');
  const functionCalls = await (vertexAiClaude
    ? promptService(generateContentVertexAiClaude)
    : vertexAi
      ? promptService(generateContentVertexAi)
      : anthropic
        ? promptService(generateContentAnthropic)
        : chatGpt
          ? promptService(generateContentGPT)
          : assert(false, 'Please specify which AI service should be used'));
  console.log('Received function calls:', functionCalls);

  if (dryRun) {
    console.log('Dry run mode, not updating files');
  } else {
    console.log('Update files');
    updateFiles(functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'));
    console.log('Done!');
  }
}
