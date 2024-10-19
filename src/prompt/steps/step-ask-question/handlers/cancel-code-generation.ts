import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleCancelCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    stepResult: StepResult.BREAK,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
        user: { type: 'user', text: 'Code generation cancelled.' },
      },
    ],
  };
}
