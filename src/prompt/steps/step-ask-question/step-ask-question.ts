import { GenerateImageFunction } from '../../../ai-service/common-types.js';
import { GenerateContentFunction, GenerateContentArgs } from '../../../ai-service/common-types.js';
import { PromptItem } from '../../../ai-service/common-types.js';
import { FunctionCall } from '../../../ai-service/common-types.js';
import { FunctionDef } from '../../../ai-service/common-types.js';
import { ModelType } from '../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../main/common/content-bus.js';
import { abortController } from '../../../main/common/abort-controller.js';
import { ActionType, AskQuestionCall } from './step-ask-question-types.js';
import { getUsageMetrics } from '../../../main/common/cost-collector.js';
import { getActionHandler } from './ask-question-handler.js';
import { executeStepAutoContextRefresh, getFilesState } from '../step-auto-context-refresh.js';

import './handlers/handle-code-generation.js';
import './handlers/handle-confirm-code-generation.js';
import './handlers/handle-context-compression.js';
import './handlers/handle-context-optimization.js';
import './handlers/handle-conversation-graph.js';
import './handlers/handle-create-file.js';
import './handlers/handle-end-conversation.js';
import './handlers/handle-genaicode-help.js';
import './handlers/handle-generate-image.js';
import './handlers/handle-perform-analysis.js';
import './handlers/handle-pull-app-context.js';
import './handlers/handle-push-app-context.js';
import './handlers/handle-reasoning-inference.js';
import './handlers/handle-remove-files-from-context.js';
import './handlers/handle-request-files-content.js';
import './handlers/handle-request-files-fragments.js';
import './handlers/handle-request-permissions.js';
import './handlers/handle-run-container-task.js';
import './handlers/handle-search-code.js';
import './handlers/handle-send-message.js';
import './handlers/handle-update-file.js';
import './handlers/handle-read-external-files.js';
import './handlers/handle-explore-external-directories.js';
import './handlers/handle-request-git-context.js';
import './handlers/handle-web-search.js';
import './handlers/handle-compound-action.js';
import './handlers/handle-project-command.js';
import './handlers/handle-run-bash-command.js';
import './handlers/handle-pull-console-logs.js';

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

  let filesState = getFilesState();

  let aborted = false;
  abortController?.signal.addEventListener('abort', () => {
    aborted = true;
  });
  let forcedActionType: ActionType | undefined = options.initialActionType;

  while (!aborted) {
    try {
      // Calculate context size using the total tokens per day (this is not a perfect metric, but it's a good approximation)
      const lastTokenCount = getUsageMetrics().total.tpd;
      if (forcedActionType) {
        putSystemMessage(`Forcing action type: ${forcedActionType}`);
      }
      const askQuestionCall = forcedActionType
        ? {
            name: 'askQuestion',
            id: 'forced-action',
            args: {
              actionType: forcedActionType,
              message: `I'm going to execute the action: ${forcedActionType}`,
            } as AskQuestionCall['args'],
          }
        : await getAskQuestionCall(generateContentFn, prompt, functionDefs, temperature, options);
      const totalTokens = getUsageMetrics().total.tpd - lastTokenCount;

      if (!askQuestionCall) {
        break;
      }

      if (askQuestionCall.args?.message && askQuestionCall.id !== 'forced-action') {
        putAssistantMessage(askQuestionCall.args.message, { ...askQuestionCall.args, contextSize: totalTokens });
      }

      const actionType = askQuestionCall.args?.actionType;
      if (actionType) {
        const actionHandler = getActionHandler(actionType);
        const result = await actionHandler({
          askQuestionCall,
          prompt,
          options,
          generateContentFn,
          generateImageFn,
          waitIfPaused,
        });
        forcedActionType = result.forceActionType;

        if (aborted) {
          putSystemMessage('Iteration aborted.');
          break;
        }

        // This is important to display the content to the user interface (ui or interactive cli)
        const lastItem = result.items.slice(-1)[0];
        if (lastItem?.user?.text || lastItem?.user?.images) {
          putUserMessage(lastItem.user.text ?? '', lastItem.user.data, undefined, lastItem.user.images, lastItem.user);
        }

        prompt.push(...result.items.map(({ assistant, user }) => [assistant, user]).flat());

        filesState = await executeStepAutoContextRefresh(filesState, generateContentFn, options, prompt);

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
    {
      functionDefs,
      requiredFunctionName: 'askQuestion',
      temperature,
      modelType: ModelType.CHEAP,
      expectedResponseType: { text: false, functionCall: true, media: false },
    },
    options,
  ];
  const askQuestionResult = (await generateContentFn(...askQuestionRequest))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall);
  return askQuestionResult.find((call) => call.name === 'askQuestion') as AskQuestionCall | undefined;
}
