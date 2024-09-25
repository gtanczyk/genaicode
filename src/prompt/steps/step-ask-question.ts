import { FunctionCall, FunctionDef, PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage } from '../../main/common/content-bus.js';
import { abortController } from '../../main/interactive/codegen-worker.js';
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
} from './step-ask-question-handlers.js';

type GenerateContentFunction = (
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string,
  temperature: number,
  cheap: boolean,
  options: CodegenOptions,
) => Promise<FunctionCall[]>;

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

  // eslint-disable-next-line no-constant-condition
  while (true) {
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
        console.log('Assistant did not ask a question. Proceeding with code generation.');
        return StepResult.CONTINUE;
      }

      console.log('Assistant asks:', askQuestionCall.args);
      if (askQuestionCall.args?.content) {
        putAssistantMessage(askQuestionCall.args.content, askQuestionCall.args);
      }

      const actionType = askQuestionCall.args?.actionType;
      if (actionType) {
        const actionHandler = getActionHandler(actionType);
        const result = await actionHandler({ askQuestionCall, prompt, options, messages });

        if (result.breakLoop) {
          return result.stepResult;
        }

        prompt.push(result.assistantItem, result.userItem);
        console.log('The question was answered');
      } else {
        console.error('Invalid action type received');
        return StepResult.BREAK;
      }

      if (abortController?.signal.aborted) {
        return StepResult.BREAK;
      }
    } catch (error) {
      console.error('Error in executeStepAskQuestion:', error);
      putSystemMessage(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
      return StepResult.BREAK;
    }
  }
}

async function getAskQuestionCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  options: CodegenOptions,
): Promise<AskQuestionCall | undefined> {
  const askQuestionResult = await generateContentFn(prompt, functionDefs, 'askQuestion', temperature, cheap, options);
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
  };

  return handlers[actionType] || handleDefaultAction;
}
