import { putAssistantMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { executeStepCodegenPlanning } from '../../step-codegen-planning.js';
import { executeStepCodegenSummary } from '../../step-codegen-summary.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleCodeGeneration({
  generateContentFn,
  generateImageFn,
  waitIfPaused,
  prompt,
  options,
  askQuestionCall,
}: ActionHandlerProps): Promise<ActionResult> {
  const planningResult = await executeStepCodegenPlanning(generateContentFn, prompt, options);
  if (planningResult === StepResult.BREAK) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Ask user to confirm the planning result
  const planningConfirmation = await askUserForConfirmationWithAnswer(
    'Planning phase completed. Would you like to proceed with the planned changes?',
    'Accept planning and continue',
    'Reject planning and return to conversation',
    true,
  );

  if (!planningConfirmation.confirmed) {
    // User rejected the planning, return to conversation
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args?.message ?? '',
            functionCalls: [],
          },
          user: {
            type: 'user',
            text: planningConfirmation.answer || 'Planning rejected. Returning to conversation.',
          },
        },
      ],
    };
  }

  putAssistantMessage('Planning phase completed. Would you like to proceed with the planned changes?');
  putUserMessage('Accept planning and continue');

  // Execute the codegen summary step
  const result = await executeStepCodegenSummary(
    generateContentFn,
    prompt,
    getFunctionDefs(),
    options,
    waitIfPaused,
    generateImageFn,
  );

  const confirmed = await askUserForConfirmationWithAnswer(
    'Code changes are generated, now what?',
    'Apply code changes',
    'Continue conversation',
    true,
  );

  return {
    breakLoop: confirmed.confirmed ?? true,
    stepResult: result,
    items: [],
  };
}
