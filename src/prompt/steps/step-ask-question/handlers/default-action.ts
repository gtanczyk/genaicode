import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleDefaultAction({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user: {
          type: 'user',
          text: "I don't want to start the code generation yet, let's talk a bit more.",
          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
        },
      },
    ],
  };
}
