import assert from 'node:assert';
import { exec } from 'child_process';
import util from 'util';

import {
  dryRun,
  chatGpt,
  anthropic,
  vertexAi,
  vertexAiClaude,
  disableInitialLint,
  helpRequested,
} from '../cli/cli-params.js';
import { validateCliParams } from '../cli/validate-cli-params.js';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';
import { promptService } from '../prompt/prompt-service.js';
import { updateFiles } from '../files/update-files.js';
import { rcConfig } from '../files/find-files.js';
import { getLintFixPrompt } from '../prompt/prompt-codegen.js';
import { printHelpMessage } from '../cli/cli-options.js';

const execPromise = util.promisify(exec);

/** Executes codegen */
export async function runCodegen() {
  // Print to console the received parameters
  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);

  validateCliParams();

  // Handle --help option
  if (helpRequested) {
    printHelpMessage();
    return;
  }

  if (rcConfig.lintCommand && !disableInitialLint) {
    try {
      console.log(`Executing lint command: ${rcConfig.lintCommand}`);
      await execPromise(rcConfig.lintCommand);
      console.log('Lint command executed successfully');
    } catch (error) {
      console.log(
        'Lint command failed. Aborting codegen, please fix lint issues before running codegen, or use --disable-initial-lint',
      );
      console.log('Lint errors:', error.stdout, error.stderr);
      process.exit(1);
    }
  } else if (rcConfig.lintCommand && disableInitialLint) {
    console.log('Initial lint was skipped.');
  }

  const generateContent = vertexAiClaude
    ? generateContentVertexAiClaude
    : vertexAi
      ? generateContentVertexAi
      : anthropic
        ? generateContentAnthropic
        : chatGpt
          ? generateContentGPT
          : assert(false, 'Please specify which AI service should be used');

  console.log('Generating response');
  let functionCalls = await promptService(generateContent);
  console.log('Received function calls:', functionCalls);

  if (dryRun) {
    console.log('Dry run mode, not updating files');
  } else {
    console.log('Update files');
    updateFiles(functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'));
    console.log('Initial updates applied');

    // Check if lintCommand is specified in .genaicoderc
    if (rcConfig.lintCommand) {
      try {
        console.log(`Executing lint command: ${rcConfig.lintCommand}`);
        await execPromise(rcConfig.lintCommand);
        console.log('Lint command executed successfully');
      } catch (error) {
        console.log('Lint command failed. Attempting to fix issues...');

        // Prepare the lint error output for the second pass
        const lintErrorPrompt = getLintFixPrompt(rcConfig.lintCommand, error.stdout, error.stderr);

        console.log('Generating response for lint fixes');
        const lintFixFunctionCalls = await promptService(generateContent, lintErrorPrompt);

        console.log('Received function calls for lint fixes:', lintFixFunctionCalls);

        console.log('Applying lint fixes');
        updateFiles(
          lintFixFunctionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),
        );

        // Run lint command again to verify fixes
        try {
          console.log(`Re-running lint command: ${rcConfig.lintCommand}`);
          await execPromise(rcConfig.lintCommand);
          console.log('Lint command executed successfully after fixes');
        } catch (secondLintError) {
          console.log('Lint command still failing after fixes. Manual intervention may be required.');
          console.log('Lint errors:', secondLintError.stdout, secondLintError.stderr);
        }
      }
    }

    console.log('Done!');
  }
}
