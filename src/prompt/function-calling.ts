import { disableExplanations } from '../cli/cli-params.js';
import { FunctionDef } from '../ai-service/common.js';
import { getSourceCode } from './function-defs/get-source-code.js';
import { getImageAssets } from './function-defs/get-image-assets.js';
import { getCodegenSummaryDef } from './function-defs/codegen-summary.js';
import { explanation } from './function-defs/explanation.js';
import { generateImage } from './function-defs/generate-image.js';
import {
  getAskQuestionDef,
  sendMessageWithImage,
  requestPermissions,
  requestFilesContent,
  removeFilesFromContext,
  contextOptimization,
  searchCode,
} from './function-defs/ask-question.js';
import { optimizeContext } from './function-defs/optimize-context.js';
import { setSummaries } from './function-defs/set-summaries.js';
import { updateHistory } from './function-defs/update-history.js';
import { readHistory } from './function-defs/read-history.js';
import { getOperationDefs } from '../operations/operations-index.js';
import { getCodegenPlanningDef } from './function-defs/codegen-planning.js';

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
    sendMessageWithImage,
    requestPermissions,
    searchCode,
    requestFilesContent,
    removeFilesFromContext,
    contextOptimization,
    optimizeContext,
    setSummaries,
    updateHistory,
    readHistory,
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
