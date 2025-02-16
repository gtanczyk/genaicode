import { getRegisteredActionHandlers } from '../../../main/plugin-loader.js';
import { ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleCodeGeneration } from './handlers/handle-code-generation.js';
import { handleConfirmCodeGeneration } from './handlers/handle-confirm-code-generation.js';
import { handleContextCompression } from './handlers/handle-context-compression.js';
import { handleContextOptimization } from './handlers/handle-context-optimization.js';
import { handleConversationGraph } from './handlers/handle-conversation-graph.js';
import { handleCreateFile } from './handlers/handle-create-file.js';
import { handleEndConversation } from './handlers/handle-end-conversation.js';
import { handleGenaicodeHelp } from './handlers/handle-genaicode-help.js';
import { handleGenerateImage } from './handlers/handle-generate-image.js';
import { handleLint } from './handlers/handle-lint.js';
import { handlePerformAnalysis } from './handlers/handle-perform-analysis.js';
import { handlePullAppContext } from './handlers/handle-pull-app-context.js';
import { handlePushAppContext } from './handlers/handle-push-app-context.js';
import { handleReasoningInference } from './handlers/handle-reasoning-inference.js';
import { handleRemoveFilesFromContext } from './handlers/handle-remove-files-from-context.js';
import { handleRequestFilesContent } from './handlers/handle-request-files-content.js';
import { handleRequestFilesFragments } from './handlers/handle-request-files-fragments.js';
import { handleRequestPermissions } from './handlers/handle-request-permissions.js';
import { handleSearchCode } from './handlers/handle-search-code.js';
import { handleSendMessage } from './handlers/handle-send-message.js';
import { handleUpdateFile } from './handlers/handle-update-file.js';

export function getActionHandler(actionType: ActionType): ActionHandler {
  // First, check if there's a plugin-provided handler for this action type
  const pluginHandler = getRegisteredActionHandlers().get(actionType as `plugin:${string}`);
  if (pluginHandler) {
    return pluginHandler;
  }

  // If no plugin handler is found, use the built-in handlers
  const handlers: Record<ActionType, ActionHandler> = {
    codeGeneration: handleCodeGeneration,
    endConversation: handleEndConversation,
    confirmCodeGeneration: handleConfirmCodeGeneration,
    requestFilesContent: handleRequestFilesContent,
    requestFilesFragments: handleRequestFilesFragments,
    requestPermissions: handleRequestPermissions,
    removeFilesFromContext: handleRemoveFilesFromContext,
    sendMessage: handleSendMessage,
    generateImage: handleGenerateImage,
    searchCode: handleSearchCode,
    lint: handleLint,
    contextOptimization: handleContextOptimization,
    updateFile: handleUpdateFile,
    createFile: handleCreateFile,
    performAnalysis: handlePerformAnalysis,
    pullAppContext: handlePullAppContext,
    genaicodeHelp: handleGenaicodeHelp,
    reasoningInference: handleReasoningInference,
    pushAppContext: handlePushAppContext,
    contextCompression: handleContextCompression,
    conversationGraph: handleConversationGraph,
  };

  return handlers[actionType] || handleSendMessage;
}
