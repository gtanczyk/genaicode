import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions';
import { getFunctionDefs } from '../../../function-calling';
import { executeStepCodegenPlanning } from '../../step-codegen-planning';
import { executeStepCodegenSummary } from '../../step-codegen-summary';
import { StepResult } from '../../steps-types';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types';

export async function handleCodeGeneration({
  generateContentFn,
  generateImageFn,
  waitIfPaused,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const planningResult = await executeStepCodegenPlanning(generateContentFn, prompt, options);
  if (planningResult === StepResult.BREAK) {
    return {
      breakLoop: true,
      items: [],
    };
  }

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
