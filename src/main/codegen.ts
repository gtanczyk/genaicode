import * as cliParams from '../cli/cli-params.js';
import { validateCliParams } from '../cli/validate-cli-params.js';
import { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';
import { generateContent as generateContentGPT } from '../ai-service/openai.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentLocalLllm } from '../ai-service/local-llm.js';
import { generateImage as generateImageDallE } from '../ai-service/dall-e.js';
import { generateImage as generateImageVertexAi } from '../ai-service/vertex-ai-imagen.js';

import { promptService } from '../prompt/prompt-service.js';
import { CodegenOptions, ImagenType } from './codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { printHelpMessage } from '../cli/cli-options.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common-types.js';
import { getCodeGenPrompt } from '../prompt/prompt-codegen.js';

import { putSystemMessage, setCurrentIterationId, unsetCurrentIterationId } from './common/content-bus.js';
import { refreshFiles } from '../files/find-files.js';
import { getRegisteredAiServices } from './plugin-loader.js';
import { stringToAiServiceType } from './codegen-utils.js';

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

    allowFileCreate: cliParams.allowFileCreate,
    allowFileDelete: cliParams.allowFileDelete,
    allowDirectoryCreate: cliParams.allowDirectoryCreate,
    allowFileMove: cliParams.allowFileMove,

    aiService: stringToAiServiceType(cliParams.aiService),
    vision: cliParams.vision,
    imagen: cliParams.imagen,

    disableContextOptimization: cliParams.disableContextOptimization,
    temperature: cliParams.temperature,
    cheap: cliParams.cheap,
    dryRun: cliParams.dryRun,
    verbose: cliParams.verbosePrompt,
    requireExplanations: !cliParams.disableExplanations,
    geminiBlockNone: cliParams.geminiBlockNone,
    contentMask: cliParams.contentMask,
    ignorePatterns: cliParams.ignorePatterns,
    askQuestion: cliParams.askQuestion,
    disableCache: cliParams.disableCache,
    interactive: cliParams.interactive,
    ui: cliParams.ui,
    uiPort: cliParams.uiPort,
    disableAiServiceFallback: cliParams.disableAiServiceFallback,
    historyEnabled: !cliParams.disableHistory,
    conversationSummaryEnabled: !cliParams.disableConversationSummary,

    isDev,
  };

  if (cliParams.ui) {
    const { runCodegenUI } = await import('./ui/codegen-ui.js');
    await runCodegenUI(options);
  } else if (cliParams.interactive) {
    const { runInteractiveMode } = await import('./interactive/codegen-interactive.js');
    // Handle interactive mode
    await runInteractiveMode(options);
  } else {
    const { runCodegenNonInteractive } = await import('./codegen-non-interactive.js');
    await runCodegenNonInteractive(options);
  }
}

export async function runCodegenIteration(
  options: CodegenOptions,
  abortSignal?: AbortSignal,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
) {
  refreshFiles();

  setCurrentIterationId();

  if (abortSignal?.aborted) {
    unsetCurrentIterationId();
    throw new Error('Codegen iteration aborted');
  }

  await waitIfPaused();

  try {
    const functionCalls = await promptService(
      getGenerateContentFunctions(),
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(options),
      waitIfPaused,
    );
    console.log('Received function calls:', functionCalls);

    return functionCalls;
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
  } finally {
    unsetCurrentIterationId();
  }
}

// helper functions and consts

export function getGenerateContentFunctions(): Record<AiServiceType, GenerateContentFunction> {
  return {
    'vertex-ai-claude': generateContentVertexAiClaude,
    'vertex-ai': generateContentVertexAi,
    'ai-studio': generateContentAiStudio,
    anthropic: generateContentAnthropic,
    openai: generateContentGPT,
    'local-llm': generateContentLocalLllm,
    ...Object.fromEntries([...getRegisteredAiServices().entries()].map(([key, value]) => [key, value.generateContent])),
  };
}

const GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {
  'dall-e': generateImageDallE,
  'vertex-ai': generateImageVertexAi,
} as const;
