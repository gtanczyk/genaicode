import { GenerateImageFunction } from '../../../ai-service/common-types.js';
import { GenerateContentFunction } from '../../../ai-service/common-types.js';
import { GenerateContentArgs } from '../../../ai-service/common-types.js';
import { PromptItem } from '../../../ai-service/common-types.js';
import { FunctionCall } from '../../../ai-service/common-types.js';
import { FunctionDef } from '../../../ai-service/common-types.js';
import { ModelType } from '../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../main/common/content-bus.js';
import { abortController } from '../../../main/common/abort-controller.js';
import { AskQuestionCall, ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleRequestFilesContent } from './handlers/request-files-content.js';
import { handleContextOptimization } from './handlers/context-optimization.js';
import { handleRemoveFilesFromContext } from './handlers/remove-files-from-context.js';
import { handleRequestPermissions } from './handlers/request-permissions.js';
import { handleSendMessage } from './handlers/handle-send-message.js';
import { handleGenerateImage } from './handlers/handle-generate-image.js';
import { handleConfirmCodeGeneration } from './handlers/confirm-code-generation.js';
import { handleEndConversation } from './handlers/handle-end-conversation.js';
import { handleLint } from './handlers/lint.js';
import { getRegisteredActionHandlers } from '../../../main/plugin-loader.js';
import { handleCodeGeneration } from './handlers/code-generation.js';
import { handleSearchCode } from './handlers/handle-search-code.js';
import { handleUpdateFile } from './handlers/handle-update-file.js';
import { handlePerformAnalysis } from './handlers/handle-perform-analysis.js';
import { handleCreateFile } from './handlers/handle-create-file.js';
import { handlePullAppContext } from './handlers/handle-pull-app-context.js';
import { handlePushAppContext } from './handlers/handle-push-app-context.js';
import { handleReasoningInference } from './handlers/handle-reasoning-inference.js';
import { handleGenaicodeHelp } from './handlers/handle-genaicode-help.js';
import { handleContextCompression } from './handlers/handle-context-compression.js';
import { getUsageMetrics } from '../../../main/common/cost-collector.js';

export async function executeStepAskQuestion(
  generateContentFn: GenerateContentFunction,
  generateImageFn: GenerateImageFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  waitIfPaused: () => Promise<void>,
  temperature: number,
  options: CodegenOptions,
): Promise<FunctionCall[]> {
  putSystemMessage('Allowing the assistant to ask a question...');

  while (!abortController?.signal.aborted) {
    try {
      // Calculate context size using the total tokens per day (this is not a perfect metric, but it's a good approximation)
      const lastTokenCount = getUsageMetrics().total.tpd;
      const askQuestionCall = await getAskQuestionCall(generateContentFn, prompt, functionDefs, temperature, options);
      const totalTokens = getUsageMetrics().total.tpd - lastTokenCount;

      if (!askQuestionCall) {
        break;
      }

      if (askQuestionCall.args?.message) {
        putAssistantMessage(askQuestionCall.args.message, { ...askQuestionCall.args, contextSize: totalTokens });
      }

      const actionType = askQuestionCall.args?.actionType;
      if (actionType) {
        const actionHandler = getActionHandler(actionType);
        let result = await actionHandler({
          askQuestionCall,
          prompt,
          options,
          generateContentFn,
          generateImageFn,
          waitIfPaused,
        });

        // This is important to display the content to the user interface (ui or interactive cli)
        let lastItem = result.items.slice(-1)[0];
        if (lastItem?.user?.text) {
          putUserMessage(lastItem.user.text, lastItem.user.data, undefined, undefined, lastItem.user);
        }

        prompt.push(...result.items.map(({ assistant, user }) => [assistant, user]).flat());

        if (result.executeCodegen) {
          result = await getActionHandler('codeGeneration')({
            askQuestionCall,
            prompt,
            options,
            generateContentFn,
            generateImageFn,
            waitIfPaused,
          });

          lastItem = result.items.slice(-1)[0];
          if (lastItem?.user?.text) {
            putUserMessage(lastItem.user.text, undefined, undefined, undefined, lastItem.user);
          }

          prompt.push(...result.items.map(({ assistant, user }) => [assistant, user]).flat());
        }

        if (result.breakLoop) {
          return result.stepResult ?? [];
        }
      } else {
        putSystemMessage('Invalid action type received');
        break;
      }
    } catch (error) {
      putSystemMessage(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  putSystemMessage('Assistant did not ask a question. This unexpected, we need to abort.');
  return [];
}

async function getAskQuestionCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  options: CodegenOptions,
): Promise<AskQuestionCall | undefined> {
  const askQuestionRequest: GenerateContentArgs = [
    prompt,
    functionDefs,
    'askQuestion',
    temperature,
    ModelType.CHEAP,
    options,
  ];
  const askQuestionResult = await generateContentFn(...askQuestionRequest);
  return askQuestionResult.find((call) => call.name === 'askQuestion') as AskQuestionCall | undefined;
}

function getActionHandler(actionType: ActionType): ActionHandler {
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
  };

  return handlers[actionType] || handleSendMessage;
}
