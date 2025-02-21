import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

registerActionHandler('endConversation', handleEndConversation);

export async function handleEndConversation({
  askQuestionCall,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmationWithAnswer(
    'Do you want to end the conversation?',
    'End conversation',
    'Continue conversation',
    true,
    options,
  );

  if (userConfirmation.answer) {
    putUserMessage(userConfirmation.answer);
  }

  prompt.push(
    {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
    },
    {
      type: 'user',
      text:
        'Declined. Please continue the conversation.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
    },
  );

  if (!userConfirmation.confirmed) {
    putSystemMessage('User declined to end the conversation.');

    return {
      breakLoop: false,
      items: [],
    };
  }

  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    items: [],
  };
}
