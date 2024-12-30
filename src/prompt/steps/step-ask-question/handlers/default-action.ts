import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleDefaultAction({ askQuestionMessage }: ActionHandlerProps): Promise<ActionResult> {
  return {
    breakLoop: false,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionMessage ?? '' },
        user: {
          type: 'user',
          text: "I don't want to start the code generation yet, let's talk a bit more.",
        },
      },
    ],
  };
}
