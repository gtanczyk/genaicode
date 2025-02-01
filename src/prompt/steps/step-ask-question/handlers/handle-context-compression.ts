import { executeStepContextCompression } from '../../step-context-compression.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';

export async function handleContextCompression({
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    // Execute compression step
    const result = await executeStepContextCompression(generateContentFn, prompt, options);

    return { breakLoop: result === StepResult.BREAK, items: [] };
  } catch (error) {
    putSystemMessage('Error during context compression', { error });
    return { breakLoop: true, items: [] };
  }
}
