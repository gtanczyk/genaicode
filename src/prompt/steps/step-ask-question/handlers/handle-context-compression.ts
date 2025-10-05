import { executeStepContextCompression } from '../../step-context-compression.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

registerActionHandler('contextCompression', handleContextCompression);

export async function handleContextCompression({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Context compression requested.');

  // First confirmation: Ask user if they want to proceed with content generation
  const compressionConfirm = await askUserForConfirmation(
    'The assistant suggests compressing the context. Do you want to proceed with context compression?',
    false,
    options,
    'Compress context',
    'Continue conversation',
  );

  if (!compressionConfirm.confirmed) {
    putSystemMessage('Context compression rejected.');

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Rejecting context compression.',
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }

  try {
    // Execute compression step
    const result = await executeStepContextCompression(generateContentFn, prompt, options);

    return { breakLoop: result === StepResult.BREAK, items: [] };
  } catch (error) {
    putSystemMessage('Error during context compression', { error });
    return { breakLoop: false, items: [] };
  }
}
