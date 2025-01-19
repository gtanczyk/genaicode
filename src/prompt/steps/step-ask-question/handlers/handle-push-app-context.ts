import { FunctionCall } from '../../../../ai-service/common.js';
import { setContextValue } from '../../../../main/common/app-context-bus.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ActionResult, ActionHandlerProps, PushAppContextArgs } from '../step-ask-question-types.js';

/**
 * Handler for pushAppContext action
 * Updates context value in the content-bus system with proper validation and error handling
 *
 * @param props Action handler properties containing the function call
 * @returns ActionResult with the updated context value and conversation items
 */
export async function handlePushAppContext({
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Updating context...');

  const [pushAppContextCall] = (await generateContentFn(
    prompt,
    getFunctionDefs(),
    'pushAppContext',
    0.7,
    true,
    options,
  )) as [FunctionCall<PushAppContextArgs>];

  if (!pushAppContextCall?.args) {
    putSystemMessage('Failed to get valid pushAppContext request');
    return { breakLoop: false, items: [] };
  }

  const { key, reason } = pushAppContextCall.args;
  let { value } = pushAppContextCall.args;

  try {
    // Validate input
    if (!key) {
      throw new Error('Context key is required');
    }

    if (value === undefined) {
      throw new Error('Context value cannot be undefined');
    }

    try {
      value = JSON.parse(value);
    } catch {
      // ignore error
    }

    // Set context value using content-bus
    // Note: setContextValue includes value validation internally
    await setContextValue(key, value);

    // Format success message
    const updateInfo = `Successfully updated context key "${key}" with value: ${JSON.stringify(value, null, 2)}`;
    const reasonInfo = reason ? `\nReason for update: ${reason}` : '';

    // Return the action result with update confirmation
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `${updateInfo}${reasonInfo}`,
          },
          user: {
            type: 'user',
            text: 'Context updated successfully.',
            data: {
              contextKey: key,
              contextValue: value,
              reason,
              operation: 'set',
            },
          },
        },
      ],
    };
  } catch (error) {
    // Handle any errors that occur during context update
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    putSystemMessage(`Error updating context: ${errorMessage}`);

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `Failed to update context for key "${key}": ${errorMessage}`,
          },
          user: {
            type: 'user',
            text: 'Context update failed.',
            data: {
              contextKey: key,
              error: errorMessage,
              reason,
              operation: 'set',
            },
          },
        },
      ],
    };
  }
}
