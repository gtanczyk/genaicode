import assert from 'node:assert';
import fs from 'fs';
import mime from 'mime-types';

import { getSystemPrompt } from './systemprompt.js';
import { functionDefs } from './function-calling.js';
import { getSourceCode, getImageAssets } from '../files/read-files.js';
import {
  PromptItem,
  FunctionDef,
  FunctionCall,
  GenerateContentFunction,
  GenerateImageFunction,
} from '../ai-service/common.js';
import { importantContext } from '../main/config.js';
import { AiServiceType, CodegenOptions, ImagenType } from '../main/codegen-types.js';
import { executeStepAskQuestion } from './steps/step-ask-question.js';
import { validateAndRecoverSingleResult } from './steps/step-validate-recover.js';
import { executeStepVerifyPatch } from './steps/step-verify-patch.js';
import { executeStepGenerateImage } from './steps/step-generate-image.js';
import { executeStepContextOptimization } from './steps/step-context-optimization.js';
import { StepResult } from './steps/steps-types.js';
import { CodegenPrompt } from './prompt-codegen.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import { handleAiServiceFallback } from './ai-service-fallback.js';
import { summarizeSourceCode } from './steps/step-summarization.js';

/** A function that communicates with model using */
export async function promptService(
  generateContentFns: Record<AiServiceType, GenerateContentFunction>,
  generateImageFns: Record<ImagenType, GenerateImageFunction>,
  codegenPrompt: CodegenPrompt,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
): Promise<FunctionCall[]> {
  const messages = prepareMessages(codegenPrompt);

  const generateContentFn: GenerateContentFunction = async (...args) => {
    return await handleAiServiceFallback(
      generateContentFns,
      codegenPrompt.options.aiService,
      codegenPrompt.options,
      ...args,
    );
  };

  const generateImageFn: GenerateImageFunction = (...args) => {
    assert(codegenPrompt.options.imagen, 'imagen value must be provided');
    return generateImageFns[codegenPrompt.options.imagen](...args);
  };

  // First stage: summarize the source code
  if (!codegenPrompt.options.disableContextOptimization) {
    await summarizeSourceCode(
      generateContentFn,
      getSourceCode({ forceAll: true }, codegenPrompt.options),
      codegenPrompt.options,
    );
  }

  // Second stage: generate code generation summary, which should not take a lot of output tokens
  const getSourceCodeRequest: FunctionCall = { name: 'getSourceCode' };

  const prompt: PromptItem[] = [
    { type: 'systemPrompt', systemPrompt: getSystemPrompt(codegenPrompt.options) },
    { type: 'user', text: messages.suggestSourceCode },
    { type: 'assistant', text: messages.requestSourceCode, functionCalls: [getSourceCodeRequest] },
  ];

  const getSourceCodeResponse: PromptItem = {
    type: 'user',
    functionResponses: [{ name: 'getSourceCode', content: messages.sourceCode }],
    cache: true,
  };
  prompt.push(getSourceCodeResponse);

  if (codegenPrompt.options.vision) {
    prompt.slice(-1)[0].text = messages.suggestImageAssets;
    prompt.push(
      { type: 'assistant', text: messages.requestImageAssets, functionCalls: [{ name: 'getImageAssets' }] },
      { type: 'user', functionResponses: [{ name: 'getImageAssets', content: messages.imageAssets }] },
    );
  }

  prompt.slice(-1)[0].text = messages.prompt;

  // Add uploaded images to the prompt if available
  if (codegenPrompt.options.images && codegenPrompt.options.images.length > 0 && codegenPrompt.options.vision) {
    prompt.slice(-1)[0].images = codegenPrompt.options.images.map((img) => ({
      base64url: img.base64url,
      mediaType: img.mediaType,
    }));
  }

  // Execute the context optimization step
  if (!codegenPrompt.options.disableContextOptimization) {
    const sourceCode = JSON.parse(messages.sourceCode);
    const optimizationResult = await executeStepContextOptimization(
      generateContentFn,
      prompt,
      sourceCode,
      codegenPrompt.options,
    );

    if (optimizationResult === StepResult.BREAK) {
      return [];
    }
  }

  // Execute the ask question step
  if (
    codegenPrompt.options.askQuestion !== false &&
    (codegenPrompt.options.interactive || codegenPrompt.options.ui) &&
    (await executeStepAskQuestion(
      generateContentFn,
      prompt,
      functionDefs,
      codegenPrompt.options.temperature ?? 0.7,
      codegenPrompt.options.cheap ?? false,
      messages,
      codegenPrompt.options,
    )) === StepResult.BREAK
  ) {
    return [];
  } else if (codegenPrompt.options.askQuestion === false) {
    console.log('Ask question is not enabled.');
  }

  const baseRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [
    prompt,
    functionDefs,
    'codegenSummary',
    codegenPrompt.options.temperature ?? 0.7,
    codegenPrompt.options.cheap ?? false,
    codegenPrompt.options,
  ];
  let baseResult = await generateContentFn(...baseRequest);

  let codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

  if (codegenSummaryRequest) {
    // Second stage: for each file request the actual code updates
    putSystemMessage('Received codegen summary, will collect partial updates', codegenSummaryRequest.args);

    baseResult = await validateAndRecoverSingleResult(baseRequest, baseResult, messages, generateContentFn);
    codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

    // Sometimes the result happens to be a string
    assert(Array.isArray(codegenSummaryRequest?.args?.fileUpdates), 'fileUpdates is not an array');
    assert(Array.isArray(codegenSummaryRequest?.args.contextPaths), 'contextPaths is not an array');

    if (!codegenPrompt.options.disableContextOptimization) {
      console.log('Optimize with context paths.');
      // Monkey patch the initial getSourceCode, do not send parts of source code that are consider irrelevant
      getSourceCodeRequest.args = {
        filePaths: [
          ...codegenSummaryRequest.args.fileUpdates.map((file: { path: string }) => file.path),
          ...codegenSummaryRequest.args.contextPaths,
          ...(importantContext.files ?? []),
        ],
      };
      getSourceCodeResponse.functionResponses!.find((item) => item.name === 'getSourceCode')!.content =
        messages.contextSourceCode(getSourceCodeRequest.args?.filePaths as string[]);
    }

    // Store the first stage response entirely in conversation history
    prompt.push({ type: 'assistant', functionCalls: baseResult });
    prompt.push({
      type: 'user',
      functionResponses: baseResult.map((call) => ({ name: call.name, call_id: call.id })),
      cache: true,
    });

    const result: FunctionCall[] = [];

    for (const file of codegenSummaryRequest!.args.fileUpdates) {
      putSystemMessage('Collecting partial update for: ' + file.path + ' using tool: ' + file.updateToolName, file);
      console.log('- Prompt:', file.prompt);
      console.log('- Temperature', file.temperature);
      console.log('- Cheap', file.cheap);
      if (codegenPrompt.options.vision) {
        console.log('- Context image assets', file.contextImageAssets);
      }

      // Check if execution is paused before proceeding
      await waitIfPaused();

      // this is needed, otherwise we will get an error
      if (prompt.slice(-1)[0].type === 'user') {
        prompt.slice(-1)[0].text = file.prompt ?? messages.partialPromptTemplate(file.path);
      } else {
        prompt.push({ type: 'user', text: file.prompt ?? messages.partialPromptTemplate(file.path) });
      }

      if (codegenPrompt.options.vision && file.contextImageAssets) {
        prompt.slice(-1)[0].images = file.contextImageAssets.map((path: string) => ({
          path,
          base64url: fs.readFileSync(path, 'base64'),
          mediaType: mime.lookup(path) || '',
        }));
      }

      const partialRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [
        prompt,
        functionDefs,
        file.updateToolName,
        file.temperature ?? codegenPrompt.options.temperature,
        file.cheap === true,
        codegenPrompt.options,
      ];
      let partialResult = await generateContentFn(...partialRequest);

      putSystemMessage('Received partial update', partialResult);

      // Validate if function call is compliant with the schema
      partialResult = await validateAndRecoverSingleResult(partialRequest, partialResult, messages, generateContentFn);

      // Handle image generation requests
      const generateImageCall = partialResult.find((call) => call.name === 'generateImage');
      if (generateImageCall) {
        partialResult.push(await executeStepGenerateImage(generateImageFn, generateImageCall));
      }

      // Verify if patchFile is one of the functions called, and test if patch is valid and can be applied successfully
      const patchFileCall = partialResult.find((call) => call.name === 'patchFile');
      if (patchFileCall) {
        partialResult = await executeStepVerifyPatch(
          patchFileCall.args as { filePath: string; patch: string },
          generateContentFn,
          prompt,
          functionDefs,
          file.temperature ?? codegenPrompt.options.temperature,
          file.cheap === true,
          messages,
          codegenPrompt.options,
        );
      }

      // add the code gen result to the context, as the subsequent code gen may depend on the result
      prompt.push(
        { type: 'assistant', functionCalls: partialResult },
        {
          type: 'user',
          functionResponses: partialResult.map((call) => ({ name: call.name, call_id: call.id })),
        },
      );

      result.push(...partialResult);
    }

    return result;
  } else {
    // This is unexpected, if happens probably means no code updates.
    putSystemMessage('Did not receive codegen summary, returning result.');
    return baseResult;
  }
}

export type PromptMessages = ReturnType<typeof prepareMessages>;

/**
 * Function to prepare messages for AI services
 */
function prepareMessages(codegen: CodegenPrompt) {
  return {
    suggestSourceCode: 'I should provide you with application source code.',
    requestSourceCode: 'Please provide application source code.',
    suggestImageAssets: 'I should also provide you with a summary of application image assets',
    requestImageAssets: 'Please provide summary of application image assets.',
    prompt:
      codegen.prompt +
      '\n Start from generating codegen summary, this summary will be used as a context to generate updates, so make sure that it contains useful information.',
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
    partialPromptTemplate(path: string) {
      return `Thank you for providing the summary, now suggest changes for the \`${path}\` file using appropriate tools.`;
    },
    invalidFunctionCall:
      'Function call was invalid, please analyze the error and respond with corrected function call.',
  };
}
