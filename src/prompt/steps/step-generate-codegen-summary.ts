import { GenerateContentArgs, GenerateContentFunction } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { FunctionDef } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions, CodegenSummaryArgs } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { executeStepEnsureContext } from './step-ensure-context.js';
import { StepResult } from './steps-types.js';
import assert from 'node:assert';
import { PROMPT_CODEGEN_SUMMARY, PROMPT_CODEGEN_SUMMARY_ASSISTANT } from './step-generate-codegen-summary-prompt.js';

/**
 * Generates and validates the codegen summary.
 * This is the first part of the original executeStepCodegenSummary function.
 * It handles generating the initial summary, validating it, and ensuring context is available.
 */
export async function generateCodegenSummary(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
): Promise<{
  codegenSummaryRequest: FunctionCall<CodegenSummaryArgs>;
  baseResult: FunctionCall[];
}> {
  const baseRequest: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: PROMPT_CODEGEN_SUMMARY_ASSISTANT,
      },
      {
        type: 'user',
        text: PROMPT_CODEGEN_SUMMARY,
      },
    ],
    {
      functionDefs,
      requiredFunctionName: 'codegenSummary',
      temperature: options.temperature ?? 0.7,
      modelType: options.cheap ? ModelType.CHEAP : ModelType.DEFAULT,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];

  const baseResult = (await generateContentFn(...baseRequest))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall);
  const codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary') as
    | FunctionCall<CodegenSummaryArgs>
    | undefined;

  if (!codegenSummaryRequest) {
    // This is unexpected, if happens probably means no code updates.
    putSystemMessage('Did not receive codegen summary, returning result.');
    throw new Error('No codegen summary received');
  }

  putSystemMessage('Received codegen summary', codegenSummaryRequest);

  // Sometimes the result happens to be a string
  assert(Array.isArray(codegenSummaryRequest?.args?.fileUpdates), 'fileUpdates is not an array');
  assert(Array.isArray(codegenSummaryRequest?.args.contextPaths), 'contextPaths is not an array');

  // Ensure all necessary files are in context
  const contextResult = await executeStepEnsureContext(prompt, codegenSummaryRequest, options);
  if (contextResult === StepResult.BREAK) {
    throw new Error('Context ensuring was interrupted');
  }

  // Store the first stage response entirely in conversation history
  prompt.push({ type: 'assistant', functionCalls: baseResult });
  prompt.push({
    type: 'user',
    functionResponses: baseResult.map((call) => ({ name: call.name, call_id: call.id })),
    cache: true,
  });

  return {
    codegenSummaryRequest,
    baseResult,
  };
}
