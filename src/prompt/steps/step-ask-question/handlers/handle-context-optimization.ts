import { refreshFiles } from '../../../../files/find-files.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { executeStepContextOptimization } from '../../step-context-optimization.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

registerActionHandler('contextOptimization', handleContextOptimization);

export async function handleContextOptimization({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant suggests optimizing the context to reduce token usage, cost, and latency. Do you want to proceed?',
    false,
    options,
  );

  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
  });

  prompt.push({
    type: 'user',
    text: userConfirmation.confirmed
      ? 'Context optimization proposal accepted.'
      : 'Context optimization proposal rejected.',
  });

  if (userConfirmation.confirmed) {
    // the request may be caused be an appearance of a new file, so lets refresh
    refreshFiles();

    // Execute context optimization step
    putSystemMessage('Executing context optimization step.');
    await executeStepContextOptimization(generateContentFn, prompt, options);
  } else {
    putSystemMessage('Context optimization rejected.');
  }

  return {
    breakLoop: false,
    items: [],
  };
}
