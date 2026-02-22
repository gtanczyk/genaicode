import { disableExplanations } from '../cli/cli-params.js';
import { FunctionDef } from '../ai-service/common-types.js';
import { getSourceCode } from './function-defs/get-source-code.js';
import { getImageAssets } from './function-defs/get-image-assets.js';
import { getCodegenSummaryDef } from './function-defs/codegen-summary.js';
import { explanation } from './function-defs/explanation.js';
import { generateImage } from './function-defs/generate-image.js';
import {
  getIterateDef,
  requestPermissions,
  requestFilesContent,
  removeFilesFromContext,
  contextOptimization,
  searchCode,
  pullAppContext,
  pushAppContext,
  requestFilesFragments,
  sendMessage,
  requestGitContextDef,
} from './function-defs/iterate.js';
import { optimizeContext } from './function-defs/optimize-context.js';
import { setSummaries } from './function-defs/set-summaries.js';
import { updateHistory } from './function-defs/update-history.js';
import { readHistory } from './function-defs/read-history.js';
import { getOperationDefs } from '../operations/operations-index.js';
import { getCodegenPlanningDef } from './function-defs/codegen-planning.js';
import { performAnalysis } from './function-defs/perform-analysis.js';
import { analysisResult } from './function-defs/analysis-result.js';
import { genaicodeHelpDef } from './function-defs/genaicode-help.js';
import { compressContext } from './function-defs/context-compression.js';
import { extractFileFragments } from './function-defs/extract-file-fragments.js';
import { getConversationGraph, evaluateEdge } from './function-defs/conversation-graph.js';
import { conversationSummaryDef } from './function-defs/conversation-summary.js';
import { readExternalFiles } from './function-defs/read-external-files.js';
import { exploreExternalDirectories } from './function-defs/explore-external-directories.js';
import { getCompoundActionDef } from './function-defs/compound-action.js';
import { runContainerTaskDef } from './function-defs/run-container-task.js';
import { getRunProjectCommandDef } from './function-defs/run-project-command.js';
import { webSearchDef } from './function-defs/web-search.js';
import { getRunBashCommandDef } from './function-defs/run-bash-command.js';
import { pullConsoleLogs } from './function-defs/pull-console-logs.js';
import { structuredQuestionDef } from './function-defs/structured-question.js';
import { codeExecutionDef } from './function-defs/code-execution.js';

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
    getIterateDef(),
    requestPermissions,
    searchCode,
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
    pullConsoleLogs,
    pushAppContext,
    genaicodeHelpDef,
    compressContext,
    extractFileFragments,
    requestFilesFragments,
    getConversationGraph(),
    evaluateEdge,
    sendMessage,
    conversationSummaryDef,
    readExternalFiles,
    exploreExternalDirectories,
    requestGitContextDef,
    getCompoundActionDef(),
    runContainerTaskDef,
    getRunProjectCommandDef(),
    getRunBashCommandDef(),
    webSearchDef,
    structuredQuestionDef,
    codeExecutionDef,
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
