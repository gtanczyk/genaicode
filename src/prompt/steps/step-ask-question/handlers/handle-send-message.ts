import { askUserForInput } from '../../../../main/common/user-actions.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleSendMessage({ askQuestionCall, options }: ActionHandlerProps): Promise<ActionResult> {
  const response = await askUserForInput('Your answer', askQuestionCall.args?.message ?? '', options);
  return {
    breakLoop: false,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
        user: {
          type: 'user',
          text: response.answer,
        },
      },
    ],
  };
}
