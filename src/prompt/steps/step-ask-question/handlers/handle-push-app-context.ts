import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { setContextValue } from '../../../../main/common/app-context-bus.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionResult, ActionHandlerProps, PushAppContextArgs } from '../step-ask-question-types.js';

registerActionHandler('pushAppContext', handlePushAppContext);

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

  const [pushAppContextCall] = (
    await generateContentFn(
      prompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'pushAppContext',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    )
  )
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<PushAppContextArgs>];

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
    const updateInfo = `Successfully updated context key "${key}"`;
    const reasonInfo = reason ? `\nReason for update: ${reason}` : '';

    putSystemMessage('Context updated successfully.', {
      contextKey: key,
      contextValue: value,
      reason,
      operation: 'set',
    });

    prompt.push(
      {
        type: 'assistant',
        text: `${updateInfo}${reasonInfo}`,
        functionCalls: [pushAppContextCall],
      },
      {
        type: 'user',
        functionResponses: [{ name: 'pushAppContext', call_id: pushAppContextCall.id, content: '' }],
      },
    );

    // Return the action result with update confirmation
    return {
      breakLoop: false,
      items: [],
    };
  } catch (error) {
    // Handle any errors that occur during context update
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    putSystemMessage(`Error updating context: ${errorMessage}`);

    prompt.push(
      {
        type: 'assistant',
        functionCalls: [pushAppContextCall],
      },
      {
        type: 'user',
        text: 'Context update failed.',
        functionResponses: [
          {
            name: 'pushAppContext',
            call_id: pushAppContextCall.id,
            content: JSON.stringify({
              contextKey: key,
              error: errorMessage,
              reason,
              operation: 'set',
            }),
          },
        ],
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }
}
