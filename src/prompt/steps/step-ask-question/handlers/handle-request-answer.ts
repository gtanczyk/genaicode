import { askUserForInput } from '../../../../main/common/user-actions.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleRequestAnswer({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const userText = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user: {
          type: 'user',
          text: userText,
          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
        },
      },
    ],
  };
}
