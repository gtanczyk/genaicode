import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleEndConversation({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
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
