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
  imagen,
} from '../cli/cli-params.ts';
import { validateCliParams } from '../cli/validate-cli-params.ts';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.ts';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt.ts';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.ts';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.ts';
import { generateImage as generateImageDallE } from '../ai-service/dall-e.ts';
import { generateImage as generateImageVertexAi } from '../ai-service/vertex-ai-imagen.ts';

import { promptService } from '../prompt/prompt-service.js';
import { updateFiles } from '../files/update-files.ts';
import { rcConfig } from '../main/config.ts';
import { getLintFixPrompt } from '../prompt/prompt-codegen.js';
import { printHelpMessage } from '../cli/cli-options.ts';
import { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.ts';

const execPromise = util.promisify(exec);

/** Executes codegen */
export async function runCodegen(): Promise<void> {
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
      const { stderr, stdout } = error as { stdout: string; stderr: string };
      console.log(
        'Lint command failed. Aborting codegen, please fix lint issues before running codegen, or use --disable-initial-lint',
      );
      console.log('Lint errors:', stdout, stderr);
      process.exit(1);
    }
  } else if (rcConfig.lintCommand && disableInitialLint) {
    console.log('Initial lint was skipped.');
  }

  const generateContent: GenerateContentFunction = vertexAiClaude
    ? generateContentVertexAiClaude
    : vertexAi
      ? generateContentVertexAi
      : anthropic
        ? generateContentAnthropic
        : chatGpt
          ? generateContentGPT
          : (() => {
              throw new Error('Please specify which AI service should be used');
            })();

  const generateImage: GenerateImageFunction | undefined =
    imagen === 'vertex-ai' ? generateImageVertexAi : imagen === 'dall-e' ? generateImageDallE : undefined;

  console.log('Generating response');
  const functionCalls = (await promptService(generateContent, generateImage)) as FunctionCall[];
  console.log('Received function calls:', functionCalls);

  if (dryRun) {
    console.log('Dry run mode, not updating files');
  } else {
    console.log('Update files');
    await updateFiles(functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'));
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
        const firstLintError = error as { stdout: string; stderr: string };
        const lintErrorPrompt = getLintFixPrompt(rcConfig.lintCommand, firstLintError.stdout, firstLintError.stderr);

        console.log('Generating response for lint fixes');
        const lintFixFunctionCalls = (await promptService(
          generateContent,
          generateImage,
          lintErrorPrompt,
        )) as FunctionCall[];

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
          const error = secondLintError as { stdout: string; stderr: string };
          console.log('Lint command still failing after fixes. Manual intervention may be required.');
          console.log('Lint errors:', error.stdout, error.stderr);
        }
      }
    }

    console.log('Done!');
  }
}
