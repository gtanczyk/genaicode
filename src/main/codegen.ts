import { exec } from 'child_process';
import util from 'util';
import assert from 'node:assert';

import * as cliParams from '../cli/cli-params.js';
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
import { AiServiceType, CodegenOptions, ImagenType } from './codegen-types.js';
import { getLintFixPrompt } from '../prompt/prompt-codegen.js';
import { printHelpMessage } from '../cli/cli-options.js';
import { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';
import { getCodeGenPrompt } from '../prompt/prompt-codegen.js';

import { runInteractiveMode } from './interactive/codegen-interactive.js';
import { runCodegenUI } from './ui/codegen-ui.js';
import { putSystemMessage, putUserMessage } from './common/content-bus.js';
import { refreshFiles } from '../files/find-files.js';

/** Executes codegen */
export async function runCodegen(isDev = false): Promise<void> {
  // Print to console the received parameters
  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);

  validateCliParams();

  // Handle --help option
  if (cliParams.helpRequested) {
    printHelpMessage();
    return;
  }

  const options: CodegenOptions = {
    explicitPrompt: cliParams.explicitPrompt,
    taskFile: cliParams.taskFile,
    considerAllFiles: cliParams.considerAllFiles,

    allowFileCreate: cliParams.allowFileCreate,
    allowFileDelete: cliParams.allowFileDelete,
    allowDirectoryCreate: cliParams.allowDirectoryCreate,
    allowFileMove: cliParams.allowFileMove,

    aiService: cliParamToAiService(),
    vision: cliParams.vision,
    imagen: cliParams.imagen,

    disableContextOptimization: cliParams.disableContextOptimization,
    temperature: cliParams.temperature,
    cheap: cliParams.cheap,
    dryRun: cliParams.dryRun,
    verbose: cliParams.verbosePrompt,
    requireExplanations: !cliParams.disableExplanations,
    geminiBlockNone: cliParams.geminiBlockNone,
    disableInitialLint: cliParams.disableInitialLint,
    contentMask: cliParams.contentMask,
    ignorePatterns: cliParams.ignorePatterns,
    askQuestion: cliParams.askQuestion,
    disableCache: cliParams.disableCache,
    interactive: cliParams.interactive,
    ui: cliParams.ui,
    disableAiServiceFallback: cliParams.disableAiServiceFallback,
    historyEnabled: !cliParams.disableHistory,
    selfReflectionEnabled: !cliParams.disableSelfReflection,

    isDev,
  };

  if (cliParams.ui) {
    await runCodegenUI(options);
  } else if (cliParams.interactive) {
    // Handle interactive mode
    await runInteractiveMode(options);
  } else {
    console.log('Executing codegen in non-interactive mode');
    await runCodegenIteration(options);
  }
}

export async function runCodegenIteration(
  options: CodegenOptions,
  abortSignal?: AbortSignal,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
) {
  refreshFiles();

  putUserMessage(options.explicitPrompt ?? options.taskFile ?? 'Run codegen iteration without explicit prompt.');

  if (rcConfig.lintCommand && !options.disableInitialLint) {
    try {
      putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);
      await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });
      putSystemMessage('Lint command executed successfully');
    } catch (error) {
      const { stderr, stdout } = error as { stdout: string; stderr: string };
      putSystemMessage(
        'Lint command failed. Aborting codegen, please fix lint issues before running codegen, or use --disable-initial-lint',
      );
      console.log('Lint errors:', stdout, stderr);
      return;
    }
  } else if (rcConfig.lintCommand && options.disableInitialLint) {
    console.log('Initial lint was skipped.');
  }

  if (abortSignal?.aborted) {
    throw new Error('Codegen iteration aborted');
  }

  await waitIfPaused();

  putSystemMessage('Generating response');
  try {
    const functionCalls = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(options),
      waitIfPaused,
    );
    console.log('Received function calls:', functionCalls);

    await waitIfPaused();

    if (functionCalls.length === 0) {
      putSystemMessage('No updates to apply');
    } else if (options.dryRun) {
      putSystemMessage('Dry run mode, not updating files');
    } else {
      putSystemMessage('Update files');
      await updateFiles(
        functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),
        options,
      );
      putSystemMessage('Initial updates applied');

      if (abortSignal?.aborted) {
        throw new Error('Codegen iteration aborted after initial updates');
      }

      await waitIfPaused();

      // Check if lintCommand is specified in .genaicoderc
      if (rcConfig.lintCommand && functionCalls.length > 0) {
        try {
          putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);
          await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });
          putSystemMessage('Lint command executed successfully');
        } catch (error) {
          putSystemMessage('Lint command failed. Attempting to fix issues...');

          // Prepare the lint error output for the second pass
          const firstLintError = error as { stdout: string; stderr: string };
          const lintErrorPrompt = getLintFixPrompt(
            rcConfig.lintCommand,
            options,
            firstLintError.stdout,
            firstLintError.stderr,
          );

          putSystemMessage('Generating response for lint fixes');
          const lintFixFunctionCalls = (await promptService(
            GENERATE_CONTENT_FNS,
            GENERATE_IMAGE_FNS,
            {
              prompt: lintErrorPrompt,
              options: { ...options, considerAllFiles: true },
            },
            waitIfPaused,
          )) as FunctionCall[];

          console.log('Received function calls for lint fixes:', lintFixFunctionCalls);

          await waitIfPaused();

          putSystemMessage('Applying lint fixes');
          updateFiles(
            lintFixFunctionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),
            options,
          );

          if (abortSignal?.aborted) {
            throw new Error('Codegen iteration aborted after lint fixes');
          }

          // Run lint command again to verify fixes
          try {
            putSystemMessage(`Re-running lint command: ${rcConfig.lintCommand}`);
            await execPromise(rcConfig.lintCommand);
            putSystemMessage('Lint command executed successfully after fixes');
          } catch (secondLintError) {
            const error = secondLintError as { stdout: string; stderr: string };
            putSystemMessage('Lint command still failing after fixes. Manual intervention may be required.');
            console.log('Lint errors:', error.stdout, error.stderr);
          }
        }
      }

      console.log('Done!');
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('interrupted')) {
        putSystemMessage('Codegen iteration was interrupted');
      } else if (error.message.includes('Rate limit exceeded')) {
        putSystemMessage(
          'Rate limit exceeded. Consider switching to a different AI service or waiting before retrying.',
        );
      } else {
        putSystemMessage(`An error occurred during codegen: ${error.message}`);
      }
    } else {
      putSystemMessage('An unknown error occurred during codegen');
    }
    console.error('Error details:', error);
  }
}

// helper functions and consts

const execPromise = util.promisify(exec);

const GENERATE_CONTENT_FNS: Record<AiServiceType, GenerateContentFunction> = {
  'vertex-ai-claude': generateContentVertexAiClaude,
  'vertex-ai': generateContentVertexAi,
  'ai-studio': generateContentAiStudio,
  anthropic: generateContentAnthropic,
  'chat-gpt': generateContentGPT,
} as const;

const GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {
  'dall-e': generateImageDallE,
  'vertex-ai': generateImageVertexAi,
} as const;

function cliParamToAiService(): AiServiceType {
  const result = cliParams.vertexAi
    ? 'vertex-ai'
    : cliParams.aiStudio
      ? 'ai-studio'
      : cliParams.vertexAiClaude
        ? 'vertex-ai-claude'
        : cliParams.chatGpt
          ? 'chat-gpt'
          : cliParams.anthropic
            ? 'anthropic'
            : undefined;
  assert(result, 'Please specify which AI service should be used');
  return result;
}
