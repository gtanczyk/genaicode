import { FunctionDef, GenerateContentFunction, PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../main/common/content-bus.js';
import { abortController } from '../../main/interactive/codegen-worker.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { AskQuestionCall, ActionType, ActionHandler } from './step-ask-question-types.js';
import {
  handleCancelCodeGeneration,
  handleConfirmCodeGeneration,
  handleStartCodeGeneration,
  handleRequestFilesContent,
  handleRequestPermissions,
  handleRemoveFilesFromContext,
  handleRequestAnswer,
  handleDefaultAction,
  handleContextOptimization,
} from './step-ask-question-handlers.js';

export async function executeStepAskQuestion(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  messages: {
    contextSourceCode: (paths: string[], pathsOnly: boolean) => string;
  },
  options: CodegenOptions,
): Promise<StepResult> {
  console.log('Allowing the assistant to ask a question...');

  while (!abortController?.signal.aborted) {
    try {
      const askQuestionCall = await getAskQuestionCall(
        generateContentFn,
        prompt,
        functionDefs,
        temperature,
        cheap,
        options,
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
  cheap: boolean,
  options: CodegenOptions,
): Promise<AskQuestionCall | undefined> {
  let askQuestionResult = await generateContentFn(prompt, functionDefs, 'askQuestion', temperature, true, options);
  askQuestionResult = await validateAndRecoverSingleResult(
    [prompt, functionDefs, 'askQuestion', temperature, cheap, options],
    askQuestionResult,
    generateContentFn,
  );
  return askQuestionResult.find((call) => call.name === 'askQuestion') as AskQuestionCall | undefined;
}

function getActionHandler(actionType: ActionType): ActionHandler {
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
