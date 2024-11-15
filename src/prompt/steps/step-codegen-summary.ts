import assert from 'node:assert';
import fs from 'fs';
import mime from 'mime-types';

import {
  FunctionCall,
  FunctionDef,
  GenerateContentFunction,
  GenerateImageFunction,
  PromptItem,
} from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
// import { importantContext } from '../../main/config.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { executeStepGenerateImage } from './step-generate-image.js';
import { executeStepVerifyPatch } from './step-verify-patch.js';
import { getPartialPromptTemplate } from '../static-prompts.js';

/**
 * Executes the codegen summary step.
 * This step generates a summary of the planned code changes and processes each file update.
 */
export async function executeStepCodegenSummary(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  // messages: { contextSourceCode: (paths: string[]) => string },
  options: CodegenOptions,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
  generateImageFn?: GenerateImageFunction,
): Promise<FunctionCall[]> {
  const baseRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [
    prompt,
    functionDefs,
    'codegenSummary',
    options.temperature ?? 0.7,
    options.cheap ?? false,
    options,
  ];
  let baseResult = await generateContentFn(...baseRequest);

  let codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

  if (codegenSummaryRequest) {
    // Second stage: for each file request the actual code updates
    putSystemMessage('Received codegen summary, will collect partial updates', codegenSummaryRequest);

    baseResult = await validateAndRecoverSingleResult(baseRequest, baseResult, generateContentFn);
    codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

    // Sometimes the result happens to be a string
    assert(Array.isArray(codegenSummaryRequest?.args?.fileUpdates), 'fileUpdates is not an array');
    assert(Array.isArray(codegenSummaryRequest?.args.contextPaths), 'contextPaths is not an array');

    // if (!options.disableContextOptimization) {
    //   console.log('Optimize with context paths.');
    //   // Monkey patch the initial getSourceCode, do not send parts of source code that are consider irrelevant
    //   getSourceCodeRequest.args = {
    //     filePaths: [
    //       ...codegenSummaryRequest.args.fileUpdates.map((file: { filePath: string }) => file.filePath),
    //       ...codegenSummaryRequest.args.contextPaths,
    //       ...(importantContext.files ?? []),
    //     ],
    //   };
    //   getSourceCodeResponse.functionResponses!.find((item) => item.name === 'getSourceCode')!.content =
    //     messages.contextSourceCode(getSourceCodeRequest.args?.filePaths as string[]);
    // }

    // Store the first stage response entirely in conversation history
    prompt.push({ type: 'assistant', functionCalls: baseResult });
    prompt.push({
      type: 'user',
      functionResponses: baseResult.map((call) => ({ name: call.name, call_id: call.id })),
      cache: true,
    });

    const result: FunctionCall[] = [];

    for (const file of codegenSummaryRequest!.args.fileUpdates) {
      putSystemMessage('Collecting partial update for: ' + file.filePath + ' using tool: ' + file.updateToolName, file);

      // Check if execution is paused before proceeding
      await waitIfPaused();

      // this is needed, otherwise we will get an error
      if (prompt.slice(-1)[0].type === 'user') {
        prompt.slice(-1)[0].text = file.prompt ?? getPartialPromptTemplate(file.filePath);
      } else {
        prompt.push({ type: 'user', text: file.prompt ?? getPartialPromptTemplate(file.filePath) });
      }

      if (options.vision && file.contextImageAssets) {
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
        file.temperature ?? options.temperature,
        file.cheap === true,
        options,
      ];
      let partialResult = await generateContentFn(...partialRequest);

      // Validate if function call is compliant with the schema
      partialResult = await validateAndRecoverSingleResult(partialRequest, partialResult, generateContentFn);

      putSystemMessage('Received partial update', partialResult);

      // Handle image generation requests
      const generateImageCall = partialResult.find((call) => call.name === 'generateImage');
      if (generateImageCall && generateImageFn) {
        partialResult.push(await executeStepGenerateImage(generateImageFn, generateImageCall));
      } else if (generateImageCall) {
        console.warn('Image generation requested but generateImageFn not provided');
      }

      // Verify if patchFile is one of the functions called, and test if patch is valid and can be applied successfully
      const patchFileCall = partialResult.find((call) => call.name === 'patchFile');
      if (patchFileCall) {
        partialResult = await executeStepVerifyPatch(
          patchFileCall.args as { filePath: string; patch: string },
          generateContentFn,
          prompt,
          functionDefs,
          file.temperature ?? options.temperature,
          file.cheap === true,
          options,
        );
      }

      // add the code gen result to the context, as the subsequent code gen may depend on the result
      prompt.push(
        { type: 'assistant', functionCalls: partialResult },
        {
          type: 'user',
          text: 'Update applied.',
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
