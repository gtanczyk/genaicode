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
import { AskQuestionCall } from './step-ask-question-types.js';
import { getUsageMetrics } from '../../../main/common/cost-collector.js';
import { getActionHandler } from './step-ask-question-handlers.js';

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
          // TODO: Why we have this, why cannot do that in the next iteration like other actions?
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
