import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleEndConversation({ askQuestionCall, options }: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmationWithAnswer(
    askQuestionCall.args?.message ?? 'Do you want to end the conversation?',
    'End conversation',
    'Continue conversation',
    true,
    options,
  );

  if (!userConfirmation.confirmed) {
    return {
      breakLoop: false,
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

  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
        user: { type: 'user', text: 'Code generation cancelled.' },
      },
    ],
  };
}
