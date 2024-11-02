import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleConfirmCodeGeneration({
  askQuestionCall,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant is ready to start code generation. Do you want to proceed?',
    'Start code generation',
    'Continue conversation',
    true,
  );
  if (userConfirmation.options?.aiService) {
    options.aiService = userConfirmation.options.aiService;
    options.cheap = userConfirmation.options.cheap;
  }
  if (userConfirmation.confirmed) {
    putSystemMessage('Proceeding with code generation.');
    return {
      breakLoop: true,
      stepResult: StepResult.CONTINUE,
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '', functionCalls: [] },
          user: { type: 'user', text: userConfirmation.answer || 'Confirmed. Proceed with code generation.' },
        },
      ],
    };
  } else {
    putSystemMessage('Declined. Continuing the conversation.');
    return {
      breakLoop: false,
      stepResult: StepResult.CONTINUE,
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
          user: {
            type: 'user',
            text: userConfirmation.answer || 'Declined. Please continue the conversation.',
          },
        },
      ],
    };
  }
}
