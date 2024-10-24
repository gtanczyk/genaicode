import { FunctionDef, GenerateContentFunction, GenerateContentArgs, PromptItem } from '../../../ai-service/common.js';
import { StepResult } from '../steps-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../main/common/content-bus.js';
import { abortController } from '../../../main/interactive/codegen-worker.js';
import { validateAndRecoverSingleResult } from '../step-validate-recover.js';
import { AskQuestionCall, ActionType, ActionHandler, SelfReflectionContext } from './step-ask-question-types.js';
import { handleRequestFilesContent } from './handlers/request-files-content.js';
import { handleContextOptimization } from './handlers/context-optimization.js';
import { handleRemoveFilesFromContext } from './handlers/remove-files-from-context.js';
import { handleRequestPermissions } from './handlers/request-permissions.js';
import { handleDefaultAction } from './handlers/default-action.js';
import { handleRequestAnswer } from './handlers/handle-request-answer.js';
import { handleStartCodeGeneration } from './handlers/start-code-generation.js';
import { handleConfirmCodeGeneration } from './handlers/confirm-code-generation.js';
import { handleCancelCodeGeneration } from './handlers/cancel-code-generation.js';
import { getRegisteredActionHandlers } from '../../../main/plugin-loader.js';
import { performSelfReflection } from './step-ask-question-reflect.js';

export async function executeStepAskQuestion(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  messages: {
    contextSourceCode: (paths: string[], pathsOnly: boolean) => string;
  },
  options: CodegenOptions,
): Promise<StepResult> {
  console.log('Allowing the assistant to ask a question...');

  const selfReflectionContext: SelfReflectionContext = {
    escalationCount: 0,
    lastEscalationTime: 0,
  };

  while (!abortController?.signal.aborted) {
    try {
      const askQuestionCall = await getAskQuestionCall(
        generateContentFn,
        prompt,
        functionDefs,
        temperature,
        options,
        selfReflectionContext,
      );

      if (!askQuestionCall) {
        break;
      }

      console.log('Assistant asks:', askQuestionCall.args);
      if (askQuestionCall.args?.content) {
        putAssistantMessage(askQuestionCall.args.content, askQuestionCall.args);
      }

      const actionType = askQuestionCall.args?.actionType;
      if (actionType) {
        const actionHandler = getActionHandler(actionType);
        const result = await actionHandler({ askQuestionCall, prompt, options, messages, generateContentFn });

        // This is important to display the content to the user interface (ui or interactive cli)
        putUserMessage(result.items.slice(-1)[0].user.text);

        if (result.breakLoop) {
          return result.stepResult;
        }

        prompt.push(...result.items.map(({ assistant, user }) => [assistant, user]).flat());
        console.log('The question was answered');
      } else {
        console.error('Invalid action type received');
        break;
      }
    } catch (error) {
      console.error('Error in executeStepAskQuestion:', error);
      putSystemMessage(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
      return StepResult.BREAK;
    }
  }

  putSystemMessage('Assistant did not ask a question. This unexpected, we need to abort.');
  return StepResult.BREAK;
}

async function getAskQuestionCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  options: CodegenOptions,
  selfReflectionContext: SelfReflectionContext,
): Promise<AskQuestionCall | undefined> {
  const askQuestionRequest: GenerateContentArgs = [prompt, functionDefs, 'askQuestion', temperature, true, options];
  let askQuestionResult = await generateContentFn(...askQuestionRequest);
  askQuestionResult = await validateAndRecoverSingleResult(askQuestionRequest, askQuestionResult, generateContentFn);

  const cheapModelResponse = askQuestionResult.find((call) => call.name === 'askQuestion') as
    | AskQuestionCall
    | undefined;

  if (cheapModelResponse) {
    const escalationDecision = await performSelfReflection(
      cheapModelResponse,
      selfReflectionContext,
      prompt,
      functionDefs,
      options,
      generateContentFn,
    );

    if (escalationDecision.shouldEscalate) {
      console.log('Self-reflection suggests escalating to non-cheap model.');
      // Re-run with non-cheap model
      const nonCheapRequest: GenerateContentArgs = [prompt, functionDefs, 'askQuestion', temperature, false, options];
      let nonCheapResult = await generateContentFn(...nonCheapRequest);
      nonCheapResult = await validateAndRecoverSingleResult(nonCheapRequest, nonCheapResult, generateContentFn);
      return nonCheapResult.find((call) => call.name === 'askQuestion') as AskQuestionCall | undefined;
    }
  }

  return cheapModelResponse;
}

function getActionHandler(actionType: ActionType): ActionHandler {
  // First, check if there's a plugin-provided handler for this action type
  const pluginHandler = getRegisteredActionHandlers().get(actionType as `plugin:${string}`);
  if (pluginHandler) {
    return pluginHandler;
  }

  // If no plugin handler is found, use the built-in handlers
  const handlers: Record<ActionType, ActionHandler> = {
    cancelCodeGeneration: handleCancelCodeGeneration,
    confirmCodeGeneration: handleConfirmCodeGeneration,
    startCodeGeneration: handleStartCodeGeneration,
    requestFilesContent: handleRequestFilesContent,
    requestPermissions: handleRequestPermissions,
    removeFilesFromContext: handleRemoveFilesFromContext,
    requestAnswer: handleRequestAnswer,
    contextOptimization: handleContextOptimization,
  };

  return handlers[actionType] || handleDefaultAction;
}
