import { askUserForInput } from '../../../../main/common/user-actions.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

registerActionHandler('sendMessage', handleSendMessage);

export async function handleSendMessage({ askQuestionCall, options }: ActionHandlerProps): Promise<ActionResult> {
  const response = await askUserForInput('Your answer', '', options, true);
  return {
    breakLoop: false,
    forceActionType: response.selectedActionType,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
        user: {
          type: 'user',
          text: response.answer,
          images: response.images,
        },
      },
    ],
  };
}
