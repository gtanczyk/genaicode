import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getActionHandler } from '../iterate-handler.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandlerProps, ActionResult } from '../step-iterate-types.js';

registerActionHandler('confirmCodeGeneration', handleConfirmCodeGeneration);

export async function handleConfirmCodeGeneration({
  iterateCall,
  options,
  prompt,
  ...props
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant is ready to start code generation. Do you want to proceed?',
    'Start code generation',
    'Continue conversation',
    true,
    options,
  );

  if (userConfirmation.answer) {
    putUserMessage(userConfirmation.answer);
  }

  if (userConfirmation.confirmed) {
    putSystemMessage('Proceeding with code generation.');

    prompt.push(
      {
        type: 'assistant',
        text: iterateCall.args?.message ?? '',
      },
      {
        type: 'user',
        text:
          'Confirmed. Proceed with code generation.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
      },
    );

    return await getActionHandler('codeGeneration')({
      iterateCall,
      options,
      prompt,
      ...props,
    });
  } else {
    putSystemMessage('Declined. Continuing the conversation.');
    prompt.push(
      { type: 'assistant', text: iterateCall.args?.message ?? '' },
      {
        type: 'user',
        text:
          'Declined. Please continue the conversation.' +
          (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }
}
