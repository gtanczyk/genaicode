import { askUserForInput } from '../../../../main/common/user-actions.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleRequestAnswer({ askQuestionCall, options }: ActionHandlerProps): Promise<ActionResult> {
  const response = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');
  if (response.options?.aiService) {
    options.aiService = response.options.aiService;
  }
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user: {
          type: 'user',
          text: response.answer,
          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id, content: undefined }],
        },
      },
    ],
  };
}
