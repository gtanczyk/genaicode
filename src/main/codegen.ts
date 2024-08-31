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
  aiStudio,
  interactive,
  cliExplicitPrompt,
  cliTaskFile,
  cliConsiderAllFiles,
} from '../cli/cli-params.js';
import { validateCliParams } from '../cli/validate-cli-params.js';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';
import { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateImage as generateImageDallE } from '../ai-service/dall-e.js';
import { generateImage as generateImageVertexAi } from '../ai-service/vertex-ai-imagen.js';

import { promptService } from '../prompt/prompt-service.js';
import { updateFiles } from '../files/update-files.js';
import { rcConfig } from '../main/config.js';
import { getLintFixPrompt } from '../prompt/prompt-codegen.js';
import { printHelpMessage } from '../cli/cli-options.js';
import { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';
import { getCodeGenPrompt } from '../prompt/prompt-codegen.js';

import { runInteractiveMode } from './codegen-interactive.js';

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

  // Handle interactive mode
  if (interactive) {
    await runInteractiveMode();
  } else {
    console.log('Executing codegen in non-interactive mode');
    await runCodegenIteration({
      explicitPrompt: cliExplicitPrompt,
      taskFile: cliTaskFile,
      considerAllFiles: cliConsiderAllFiles,
    });
  }
}

export async function runCodegenIteration(options: {
  taskFile?: string;
  explicitPrompt?: string;
  considerAllFiles?: boolean;
}) {
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
          : aiStudio
            ? generateContentAiStudio
            : (() => {
                throw new Error('Please specify which AI service should be used');
              })();

  const generateImage: GenerateImageFunction | undefined =
    imagen === 'vertex-ai' ? generateImageVertexAi : imagen === 'dall-e' ? generateImageDallE : undefined;

  console.log('Generating response');
  const functionCalls = await promptService(generateContent, generateImage, getCodeGenPrompt(options));
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
        const lintFixFunctionCalls = (await promptService(generateContent, generateImage, {
          prompt: lintErrorPrompt,
          options: { considerAllFiles: true },
        })) as FunctionCall[];

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
