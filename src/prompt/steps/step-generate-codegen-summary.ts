import { FunctionCall, FunctionDef, GenerateContentFunction, PromptItem } from '../../ai-service/common.js';
import { CodegenOptions, CodegenSummaryArgs } from '../../main/codegen-types.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
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
  const baseRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [
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
    functionDefs,
    'codegenSummary',
    options.temperature ?? 0.7,
    options.cheap ?? false,
    options,
  ];

  let baseResult = await generateContentFn(...baseRequest);
  baseResult = await validateAndRecoverSingleResult(baseRequest, baseResult, generateContentFn);
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
