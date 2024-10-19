import { refreshFiles } from '../../../../files/find-files.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { executeStepContextOptimization } from '../../step-context-optimization.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult, UserItem, AssistantItem } from '../step-ask-question-types.js';

export async function handleContextOptimization({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant suggests optimizing the context to reduce token usage, cost, and latency. Do you want to proceed?',
    false,
  );

  const user: UserItem = {
    type: 'user',
    text: userConfirmation ? 'Context optimization applied.' : 'Context optimization not applied.',
    functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
  };

  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.content ?? '',
    functionCalls: [askQuestionCall],
  };

  if (userConfirmation) {
    // the request may be caused be an appearance of a new file, so lets refresh
    refreshFiles();

    // Execute context optimization step
    putSystemMessage('Executing context optimization step.');
    await executeStepContextOptimization(generateContentFn, [...prompt, assistant, user], options);
  }

  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant,
        user,
      },
    ],
  };
}