import fs from 'fs';
import mime from 'mime-types';
import { GenerateContentArgs, GenerateImageFunction } from '../../ai-service/common-types.js';
import { GenerateContentFunction } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { PromptImageMediaType } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { FunctionDef } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions, CodegenSummaryArgs, FileUpdate } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { executeStepGenerateImage } from './step-generate-image.js';
import { executeStepVerifyPatch } from './step-verify-patch.js';
import { getPartialPromptTemplate } from '../static-prompts.js';
import { getSourceCode } from '../../files/read-files.js';
import { abortController } from '../../main/common/abort-controller.js';

/**
 * Processes file updates from the codegen summary.
 * This is the second part of the original executeStepCodegenSummary function.
 * It handles processing individual file updates, image generation, and patch verification.
 */
export async function processFileUpdates(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
  codegenSummaryRequest: FunctionCall<CodegenSummaryArgs>,
  waitIfPaused: () => Promise<void> = () => Promise.resolve(),
  generateImageFn?: GenerateImageFunction,
): Promise<FunctionCall[]> {
  const result: FunctionCall[] = [];

  if (!Array.isArray(codegenSummaryRequest.args?.fileUpdates)) {
    putSystemMessage('No file updates found in codegen summary');
    return result;
  }

  for (const file of codegenSummaryRequest.args.fileUpdates) {
    try {
      const fileResult = await processFileUpdate(
        file,
        generateContentFn,
        generateImageFn,
        prompt,
        functionDefs,
        options,
        waitIfPaused,
      );

      if (fileResult.success) {
        result.push(...fileResult.functionCalls);
      } else {
        putSystemMessage(`Failed to process update for ${file.filePath}`, { error: fileResult.error });
      }

      if (abortController?.signal.aborted) {
        putSystemMessage('Code generation aborted');
        break;
      }
    } catch (error) {
      putSystemMessage(`Unexpected error processing update for ${file.filePath}`, { error });
    }
  }

  return result;
}

interface ProcessFileUpdateResult {
  success: boolean;
  functionCalls: FunctionCall[];
  error?: Error;
}

/**
 * Processes a single file update, handling image generation and patch verification.
 * @returns Object containing success status and function calls or error
 */
async function processFileUpdate(
  file: FileUpdate,
  generateContentFn: GenerateContentFunction,
  generateImageFn: GenerateImageFunction | undefined,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
  waitIfPaused: () => Promise<void>,
): Promise<ProcessFileUpdateResult> {
  try {
    putSystemMessage('Collecting partial update for: ' + file.filePath + ' using tool: ' + file.updateToolName, file);

    // Check if execution is paused before proceeding
    await waitIfPaused();

    // Update prompt with file-specific information
    if (prompt.slice(-1)[0].type === 'user') {
      prompt.slice(-1)[0].text = getPartialPromptTemplate(file);
    } else {
      prompt.push({ type: 'user', text: getPartialPromptTemplate(file) });
    }

    // Handle image assets if vision is enabled
    if (options.vision && file.contextImageAssets) {
      prompt.slice(-1)[0].images = file.contextImageAssets.map((path: string) => ({
        path,
        base64url: fs.readFileSync(path, 'base64'),
        mediaType: (mime.lookup(path) || '') as PromptImageMediaType,
      }));
    }

    // Prepare and execute content generation request
    const partialRequest: GenerateContentArgs = [
      prompt,
      {
        functionDefs,
        requiredFunctionName: file.updateToolName,
        temperature: file.temperature ?? options.temperature!,
        modelType: file.cheap ? ModelType.CHEAP : ModelType.DEFAULT,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      options,
    ];
    let partialResult = (await generateContentFn(...partialRequest))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    // Verify patch file operations
    const patchFileCall = partialResult.find((call) => call.name === 'patchFile');
    if (patchFileCall) {
      partialResult = [
        await executeStepVerifyPatch(
          patchFileCall.args as { filePath: string; patch: string; explanation: string },
          generateContentFn,
          prompt,
          functionDefs,
          file.temperature ?? options.temperature!,
          file.cheap === true,
          options,
        ),
      ];
    }

    // Add current content
    const fileUpdateResult = partialResult[0];
    if (fileUpdateResult.args) {
      const fileSource = getSourceCode({ filterPaths: [file.filePath], forceAll: true }, options)[file.filePath];
      if (fileSource && 'content' in fileSource) {
        fileUpdateResult.args.oldContent = fileSource.content;
      }
    }

    putSystemMessage('Received partial update', fileUpdateResult);

    // Handle image generation requests
    const generateImageCall = partialResult.find((call) => call.name === 'generateImage');
    if (generateImageCall && generateImageFn) {
      partialResult.push(await executeStepGenerateImage(generateImageFn, generateImageCall));
    } else if (generateImageCall) {
      console.warn('Image generation requested but generateImageFn not provided');
    }

    // Update prompt with results
    prompt.push(
      { type: 'assistant', functionCalls: partialResult },
      {
        type: 'user',
        // TODO: Not always true
        text: 'Update applied.',
        functionResponses: partialResult.map((call) => ({ name: call.name, call_id: call.id })),
      },
    );

    return {
      success: true,
      functionCalls: partialResult,
    };
  } catch (error) {
    return {
      success: false,
      functionCalls: [],
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
