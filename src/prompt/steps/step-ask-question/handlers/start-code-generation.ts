import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleStartCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Proceeding with code generation.');
  return {
    breakLoop: true,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.message ?? '' },
        user: { type: 'user', text: 'Proceeding with code generation.' },
      },
    ],
  };
}
