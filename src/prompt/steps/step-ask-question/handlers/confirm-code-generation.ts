import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleConfirmCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant is ready to start code generation. Do you want to proceed?',
    true,
  );
  if (userConfirmation) {
    putSystemMessage('Proceeding with code generation.');
    return {
      breakLoop: true,
      stepResult: StepResult.CONTINUE,
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
          user: { type: 'user', text: 'Confirmed. Proceed with code generation.' },
        },
      ],
    };
  } else {
    putSystemMessage('Declined. Continuing the conversation.');
    return {
      breakLoop: false,
      stepResult: StepResult.CONTINUE,
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
          user: {
            type: 'user',
            text: 'Declined. Please continue the conversation.',
            functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
          },
        },
      ],
    };
  }
}
