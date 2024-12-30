import { askUserForInput } from '../../../../main/common/user-actions.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleSendMessage({ askQuestionMessage, options }: ActionHandlerProps): Promise<ActionResult> {
  const response = await askUserForInput('Your answer', askQuestionMessage ?? '');
  if (response.options?.aiService) {
    options.aiService = response.options.aiService;
  }
  return {
    breakLoop: false,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionMessage ?? '' },
        user: {
          type: 'user',
          text: response.answer,
        },
      },
    ],
  };
}
