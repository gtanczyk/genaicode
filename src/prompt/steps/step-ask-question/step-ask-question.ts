import {
  FunctionDef,
  GenerateContentFunction,
  GenerateContentArgs,
  PromptItem,
  GenerateImageFunction,
  FunctionCall,
} from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../main/common/content-bus.js';
import { abortController } from '../../../main/interactive/codegen-worker.js';
import { validateAndRecoverSingleResult } from '../step-validate-recover.js';
import { AskQuestionCall, ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleRequestFilesContent } from './handlers/request-files-content.js';
import { handleContextOptimization } from './handlers/context-optimization.js';
import { handleRemoveFilesFromContext } from './handlers/remove-files-from-context.js';
import { handleRequestPermissions } from './handlers/request-permissions.js';
import { handleDefaultAction } from './handlers/default-action.js';
import { handleSendMessage } from './handlers/handle-send-message.js';
import { handleSendMessageWithImage } from './handlers/handle-send-message-with-image.js';
import { handleConfirmCodeGeneration } from './handlers/confirm-code-generation.js';
import { handleCancelCodeGeneration } from './handlers/cancel-code-generation.js';
import { handleLint } from './handlers/lint.js';
import { getRegisteredActionHandlers } from '../../../main/plugin-loader.js';
import { handleCodeGeneration } from './handlers/code-generation.js';

export async function executeStepAskQuestion(
  generateContentFn: GenerateContentFunction,
  generateImageFn: GenerateImageFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  waitIfPaused: () => Promise<void>,
  temperature: number,
  options: CodegenOptions,
): Promise<FunctionCall[]> {
  console.log('Allowing the assistant to ask a question...');

  while (!abortController?.signal.aborted) {
    try {
      const askQuestionCall = await getAskQuestionCall(generateContentFn, prompt, functionDefs, temperature, options);

      if (!askQuestionCall) {
        break;
      }

      console.log('Assistant asks:', askQuestionCall.args);
      if (askQuestionCall.args?.message) {
        putAssistantMessage(askQuestionCall.args.message, askQuestionCall.args);
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
        const lastItem = result.items.slice(-1)[0];
        putUserMessage(lastItem.user.text, lastItem.user.data);

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

          putUserMessage(result.items.slice(-1)[0].user.text);

          prompt.push(...result.items.map(({ assistant, user }) => [assistant, user]).flat());
        }

        if (result.breakLoop) {
          return result.stepResult ?? [];
        }

        console.log('The question was answered');
      } else {
        console.error('Invalid action type received');
        break;
      }
    } catch (error) {
      console.error('Error in executeStepAskQuestion:', error);
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
  const askQuestionRequest: GenerateContentArgs = [prompt, functionDefs, 'askQuestion', temperature, true, options];
  let askQuestionResult = await generateContentFn(...askQuestionRequest);
  askQuestionResult = await validateAndRecoverSingleResult(askQuestionRequest, askQuestionResult, generateContentFn);

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
    cancelCodeGeneration: handleCancelCodeGeneration,
    confirmCodeGeneration: handleConfirmCodeGeneration,
    requestFilesContent: handleRequestFilesContent,
    requestPermissions: handleRequestPermissions,
    removeFilesFromContext: handleRemoveFilesFromContext,
    sendMessage: handleSendMessage,
    sendMessageWithImage: handleSendMessageWithImage,
    lint: handleLint,
    contextOptimization: handleContextOptimization,
  };

  return handlers[actionType] || handleDefaultAction;
}
