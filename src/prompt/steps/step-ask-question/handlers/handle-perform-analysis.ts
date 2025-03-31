import { GenerateFunctionCallsFunction } from '../../../../ai-service/common-types.js';
import { GenerateFunctionCallsArgs } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionDef } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import {
  ActionHandlerProps,
  ActionResult,
  AnalysisResultCall,
  PerformAnalysisCall,
} from '../step-ask-question-types.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { performAnalysis } from '../../../function-defs/perform-analysis.js';
import { analysisResult } from '../../../function-defs/analysis-result.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { askUserForInput } from '../../../../main/common/user-actions.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

registerActionHandler('performAnalysis', handlePerformAnalysis);

/**
 * Handles the performAnalysis action by executing analysis with enhanced context
 * and processing the results.
 */
export async function handlePerformAnalysis({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
  waitIfPaused,
}: ActionHandlerProps): Promise<ActionResult> {
  const functionDefs: FunctionDef[] = [performAnalysis, analysisResult];

  try {
    // Wait if paused
    await waitIfPaused();

    prompt.push({
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
    });

    // Get the performAnalysis call from the assistant
    const performAnalysisRequest = await getPerformAnalysisCall(generateContentFn, prompt, functionDefs, options);

    if (!performAnalysisRequest?.args) {
      putSystemMessage('Failed to get valid performAnalysis request');
      return { breakLoop: true, items: [] };
    }

    prompt.slice(-1)[0].functionCalls = [performAnalysisRequest];

    // Prepare enhanced context
    prompt.push({
      type: 'user',
      text: performAnalysisRequest.args.prompt,
      functionResponses: [{ name: 'performAnalysis', call_id: performAnalysisRequest.id, content: '' }],
    });

    // Execute analysis
    const analysisResultCall = await executeAnalysis(generateContentFn, prompt, functionDefs, options);

    if (!analysisResultCall) {
      putSystemMessage('Failed to get valid analysis results');
      return { breakLoop: true, items: [] };
    }

    putAssistantMessage(analysisResultCall.args?.message ?? '', {
      analysisRequest: performAnalysisRequest.args,
      analysisResult: analysisResultCall.args,
    });

    const response = await askUserForInput('Your answer', analysisResultCall.args?.message ?? '', options);

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: analysisResultCall.args?.message ?? '',
            functionCalls: [analysisResultCall],
          },
          user: {
            type: 'user',
            text: response.answer,
            functionResponses: [{ name: 'analysisResult', call_id: analysisResultCall.id, content: '' }],
          },
        },
      ],
    };
  } catch (error) {
    putSystemMessage(`Error during analysis: ${error instanceof Error ? error.message : String(error)}`);
    return { breakLoop: true, items: [] };
  }
}

/**
 * Gets the performAnalysis call from the assistant
 */
async function getPerformAnalysisCall(
  generateContentFn: GenerateFunctionCallsFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
): Promise<PerformAnalysisCall | undefined> {
  const performAnalysisRequest: GenerateFunctionCallsArgs = [
    prompt,
    functionDefs,
    'performAnalysis',
    0.7,
    ModelType.CHEAP,
    options,
  ];
  const performAnalysisResult = await generateContentFn(...performAnalysisRequest);
  return performAnalysisResult.find((call) => call.name === 'performAnalysis') as PerformAnalysisCall | undefined;
}

/**
 * Executes the analysis with the enhanced context
 */
async function executeAnalysis(
  generateContentFn: GenerateFunctionCallsFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
): Promise<AnalysisResultCall | undefined> {
  const analysisRequest: GenerateFunctionCallsArgs = [
    prompt,
    functionDefs,
    'analysisResult',
    0.7,
    ModelType.DEFAULT,
    options,
  ];
  const analysisResult = await generateContentFn(...analysisRequest);
  return analysisResult.find((call) => call.name === 'analysisResult') as AnalysisResultCall | undefined;
}
