import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleDefaultAction({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
        user: {
          type: 'user',
          text: "I don't want to start the code generation yet, let's talk a bit more.",
        },
      },
    ],
  };
}
