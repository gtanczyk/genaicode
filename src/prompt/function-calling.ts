import { disableExplanations } from '../cli/cli-params.js';
import { FunctionDef } from '../ai-service/common-types.js';
import { getSourceCode } from './function-defs/get-source-code.js';
import { getImageAssets } from './function-defs/get-image-assets.js';
import { getCodegenSummaryDef } from './function-defs/codegen-summary.js';
import { explanation } from './function-defs/explanation.js';
import { generateImage } from './function-defs/generate-image.js';
import {
  getAskQuestionDef,
  requestPermissions,
  requestFilesContent,
  removeFilesFromContext,
  contextOptimization,
  searchCode,
  lint,
  pullAppContext,
  pushAppContext,
  requestFilesFragments,
  sendMessage,
} from './function-defs/ask-question.js';
import { optimizeContext } from './function-defs/optimize-context.js';
import { setSummaries } from './function-defs/set-summaries.js';
import { updateHistory } from './function-defs/update-history.js';
import { readHistory } from './function-defs/read-history.js';
import { getOperationDefs } from '../operations/operations-index.js';
import { getCodegenPlanningDef } from './function-defs/codegen-planning.js';
import { performAnalysis } from './function-defs/perform-analysis.js';
import { analysisResult } from './function-defs/analysis-result.js';
import { genaicodeHelpDef } from './function-defs/genaicode-help.js';
import { reasoningInference, reasoningInferenceResponse } from './function-defs/reasoning-inference.js';
import { compressContext } from './function-defs/context-compression.js';
import { extractFileFragments } from './function-defs/extract-file-fragments.js';
import { conversationGraph } from './function-defs/conversation-graph.js';

/**
 * Function definitions for function calling feature
 */
export function getFunctionDefs(): FunctionDef[] {
  return [
    getSourceCode,
    getImageAssets,
    getCodegenSummaryDef(),
    getCodegenPlanningDef(),
    explanation,
    generateImage,
    getAskQuestionDef(),
    requestPermissions,
    searchCode,
    lint,
    requestFilesContent,
    removeFilesFromContext,
    contextOptimization,
    optimizeContext,
    setSummaries,
    updateHistory,
    readHistory,
    performAnalysis,
    analysisResult,
    pullAppContext,
    pushAppContext,
    genaicodeHelpDef,
    reasoningInference,
    compressContext,
    reasoningInferenceResponse,
    extractFileFragments,
    requestFilesFragments,
    conversationGraph,
    sendMessage,
    ...getOperationDefs(),
  ].map((fd: FunctionDef) => {
    if (
      !disableExplanations &&
      fd.parameters.properties.explanation &&
      !fd.parameters.required.includes('explanation')
    ) {
      fd.parameters.required.unshift('explanation');
    } else if (disableExplanations) {
      delete fd.parameters.properties.explanation;
    }

    return fd;
  });
}
