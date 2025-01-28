import assert from 'node:assert';

import { getSystemPrompt } from './systemprompt.js';
import { getFunctionDefs } from './function-calling.js';
import { getSourceCode, getImageAssets } from '../files/read-files.js';
import { GenerateImageFunction } from '../ai-service/common-types.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';
import { PromptItem } from '../ai-service/common-types.js';
import { FunctionCall } from '../ai-service/common-types.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { executeStepAskQuestion } from './steps/step-ask-question/step-ask-question.js';
import { executeStepContextOptimization } from './steps/step-context-optimization.js';
import { StepResult } from './steps/steps-types.js';
import { CodegenPrompt } from './prompt-codegen.js';
import { handleAiServiceFallback } from './ai-service-fallback.js';
import { summarizeSourceCode } from './steps/step-summarization.js';
import { executeStepHistoryUpdate, getCurrentHistory } from './steps/step-history-update.js';
import { executeStepGenerateSummary } from './steps/step-generate-summary.js';
import { INITIAL_GREETING, REQUEST_SOURCE_CODE, SOURCE_CODE_RESPONSE, READY_TO_ASSIST } from './static-prompts.js';
import { executeStepCodegenPlanning } from './steps/step-codegen-planning.js';
import { getRegisteredGenerateContentHooks } from '../main/plugin-loader.js';
import { generateCodegenSummary } from './steps/step-generate-codegen-summary.js';
import { processFileUpdates } from './steps/step-process-file-updates.js';
import { putSystemMessage, putUserMessage } from '../main/common/content-bus.js';
import { rcConfig } from '../main/config.js';

/** A function that communicates with model using */
export async function promptService(
  generateContentFns: Record<AiServiceType, GenerateContentFunction>,
  generateImageFns: Record<ImagenType, GenerateImageFunction>,
  codegenPrompt: CodegenPrompt,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
): Promise<FunctionCall[]> {
  const generateContentFn: GenerateContentFunction = async (...args) => {
    // Get the base result from the AI service
    const result = await handleAiServiceFallback(generateContentFns, codegenPrompt.options, ...args);

    // Get registered hooks for the current AI service
    for (const hook of getRegisteredGenerateContentHooks()) {
      await hook(args, result);
    }

    return result;
  };

  const generateImageFn: GenerateImageFunction = (...args) => {
    assert(codegenPrompt.options.imagen, 'imagen value must be provided');
    return generateImageFns[codegenPrompt.options.imagen](...args);
  };

  const { result, prompt } = await executePromptService(
    generateContentFn,
    generateImageFn,
    codegenPrompt,
    waitIfPaused,
  );

  if (codegenPrompt.options.historyEnabled) {
    await executeStepHistoryUpdate(generateContentFn, prompt, codegenPrompt.options);
  }

  return result;
}

async function executePromptService(
  generateContentFn: GenerateContentFunction,
  generateImageFn: GenerateImageFunction,
  codegenPrompt: CodegenPrompt,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
): Promise<{ result: FunctionCall[]; prompt: PromptItem[] }> {
  // First stage: summarize the source code
  if (!codegenPrompt.options.disableContextOptimization) {
    await summarizeSourceCode(
      generateContentFn,
      getSourceCode({ forceAll: true }, codegenPrompt.options),
      codegenPrompt.options,
    );
  }

  // Prepare messages for AI services
  const messages = prepareMessages(codegenPrompt);

  // Second stage: generate code generation summary, which should not take a lot of output tokens
  const getSourceCodeRequest: FunctionCall = { name: 'getSourceCode' };

  const prompt: PromptItem[] = [
    { type: 'systemPrompt', systemPrompt: getSystemPrompt(rcConfig, codegenPrompt.options) },
    { type: 'user', text: INITIAL_GREETING },
    {
      type: 'assistant',
      text: REQUEST_SOURCE_CODE,
      functionCalls: [
        getSourceCodeRequest,
        ...(codegenPrompt.options.vision ? [{ name: 'getImageAssets' }] : []),
        ...(codegenPrompt.options.historyEnabled ? [{ name: 'readHistory' }] : []),
      ],
    },
  ];

  const getSourceCodeResponse: PromptItem = {
    type: 'user',
    functionResponses: [
      { name: 'getSourceCode', content: messages.sourceCode },
      ...(codegenPrompt.options.vision ? [{ name: 'getImageAssets', content: messages.imageAssets }] : []),
      ...(codegenPrompt.options.historyEnabled ? [{ name: 'readHistory', content: getCurrentHistory() }] : []),
    ],
    text: SOURCE_CODE_RESPONSE,
    cache: true,
  };
  prompt.push(getSourceCodeResponse);

  prompt.push({
    type: 'assistant',
    text: READY_TO_ASSIST,
  });

  const initialPromptItem: PromptItem = {
    type: 'user',
    text: codegenPrompt.prompt,
  };

  prompt.push(initialPromptItem);

  // Add uploaded images to the prompt if available
  if (codegenPrompt.options.images && codegenPrompt.options.images.length > 0 && codegenPrompt.options.vision) {
    prompt.slice(-1)[0].images = codegenPrompt.options.images.map((img) => ({
      base64url: img.base64url,
      mediaType: img.mediaType,
    }));
  }

  putUserMessage(
    codegenPrompt.options.explicitPrompt ??
      codegenPrompt.options.taskFile ??
      'Run codegen iteration without explicit prompt.',
    undefined,
    undefined,
    codegenPrompt.options.images,
    initialPromptItem,
  );
  // Initial summary based on first user input
  await executeStepGenerateSummary(generateContentFn, prompt, codegenPrompt.options);

  // Execute the context optimization step
  if (!codegenPrompt.options.disableContextOptimization) {
    const optimizationResult = await executeStepContextOptimization(generateContentFn, prompt, codegenPrompt.options);

    if (optimizationResult === StepResult.BREAK) {
      return { result: [], prompt };
    }
  }

  // Execute the ask question step
  if (codegenPrompt.options.askQuestion !== false && (codegenPrompt.options.interactive || codegenPrompt.options.ui)) {
    const askQuestionResult = await executeStepAskQuestion(
      generateContentFn,
      generateImageFn,
      prompt,
      getFunctionDefs(),
      waitIfPaused,
      codegenPrompt.options.temperature ?? 0.7,
      codegenPrompt.options,
    );

    // Summary based on the ask-question conversation history (may be different from the initial summary)
    await executeStepGenerateSummary(generateContentFn, prompt, codegenPrompt.options);

    return { result: askQuestionResult, prompt };
  } else if (codegenPrompt.options.askQuestion === false) {
    console.log('Ask question is not enabled.');
    // Also there is no need to generate conversation summary

    const planningResult = await executeStepCodegenPlanning(generateContentFn, prompt, codegenPrompt.options);
    if (planningResult === StepResult.BREAK) {
      return { result: [], prompt };
    }

    // Execute the codegen summary step (now split into two steps)
    try {
      // First step: Generate and validate codegen summary
      const { codegenSummaryRequest } = await generateCodegenSummary(
        generateContentFn,
        prompt,
        getFunctionDefs(),
        codegenPrompt.options,
      );

      // Second step: Process file updates
      const result = await processFileUpdates(
        generateContentFn,
        prompt,
        getFunctionDefs(),
        codegenPrompt.options,
        codegenSummaryRequest,
        waitIfPaused,
        generateImageFn,
      );

      return { result, prompt };
    } catch (error) {
      putSystemMessage('Error during code generation', { error });
      return { result: [], prompt };
    }
  } else {
    putSystemMessage('Code generation skipped altogether.');
    return { result: [], prompt };
  }
}

/**
 * Function to prepare messages for AI services
 */
function prepareMessages(codegen: CodegenPrompt) {
  return {
    sourceCode: JSON.stringify(getSourceCode({ taskFile: codegen.options.taskFile }, codegen.options)),
    contextSourceCode: (paths: string[], pathsOnly: boolean = false) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(
            getSourceCode({ filterPaths: paths, taskFile: codegen.options.taskFile, forceAll: true }, codegen.options),
          ).filter(([path]) => !pathsOnly || paths.includes(path)),
        ),
      ),
    imageAssets: JSON.stringify(getImageAssets()),
  };
}
