import { refreshFiles } from '../../../../files/find-files.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { executeStepContextOptimization } from '../../step-context-optimization.js';
import { ActionHandlerProps, ActionResult, UserItem, AssistantItem } from '../step-ask-question-types.js';

export async function handleContextOptimization({
  askQuestionMessage,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant suggests optimizing the context to reduce token usage, cost, and latency. Do you want to proceed?',
    false,
  );

  if (userConfirmation.options?.aiService) {
    options.aiService = userConfirmation.options.aiService;
    options.cheap = userConfirmation.options.cheap;
  }

  const user: UserItem = {
    type: 'user',
    text: userConfirmation ? 'Context optimization applied.' : 'Context optimization not applied.',
  };

  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionMessage ?? '',
  };

  if (userConfirmation.confirmed) {
    // the request may be caused be an appearance of a new file, so lets refresh
    refreshFiles();

    // Execute context optimization step
    putSystemMessage('Executing context optimization step.');
    await executeStepContextOptimization(generateContentFn, [...prompt, assistant, user], options);
  }

  return {
    breakLoop: false,
    items: [
      {
        assistant,
        user,
      },
    ],
  };
}
