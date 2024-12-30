import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleCancelCodeGeneration({ askQuestionMessage }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionMessage ?? '' },
        user: { type: 'user', text: 'Code generation cancelled.' },
      },
    ],
  };
}
