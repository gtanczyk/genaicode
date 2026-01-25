import { askUserForInput } from '../../../../main/common/user-actions.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandlerProps, ActionResult } from '../step-iterate-types.js';

registerActionHandler('sendMessage', handleSendMessage);

export async function handleSendMessage({ iterateCall, options }: ActionHandlerProps): Promise<ActionResult> {
  const response = await askUserForInput('Your answer', '', options, true);
  return {
    breakLoop: false,
    forceActionType: response.selectedActionType,
    items: [
      {
        assistant: { type: 'assistant', text: iterateCall.args?.message ?? '' },
        user: {
          type: 'user',
          text: response.answer,
          images: response.images,
        },
      },
    ],
  };
}
