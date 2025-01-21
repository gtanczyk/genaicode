import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getContextValue } from '../../../../main/common/app-context-bus.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ActionResult, ActionHandlerProps, PullAppContextArgs } from '../step-ask-question-types.js';

/**
 * Handler for pullAppContext action
 * Retrieves context value from the content-bus system and includes it in the conversation
 *
 * @param props Action handler properties containing the function call
 * @returns ActionResult with the context value and conversation items
 */
export async function handlePullAppContext({
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Retrieving context...');
  const [pullAppContextCall] = (await generateContentFn(
    prompt,
    getFunctionDefs(),
    'pullAppContext',
    0.7,
    ModelType.CHEAP,
    options,
  )) as [FunctionCall<PullAppContextArgs> | undefined];

  if (!pullAppContextCall?.args) {
    putSystemMessage('Failed to get valid pullAppContext request');
    return { breakLoop: false, items: [] };
  }

  const { key, reason } = pullAppContextCall.args;

  try {
    // Validate input
    if (!key) {
      throw new Error('Context key is required');
    }

    // Get context value from content-bus
    const contextValue = await getContextValue(key);

    // Format the response for conversation
    const contextInfo = contextValue
      ? `Retrieved context value for key "${key}": ${JSON.stringify(contextValue, null, 2)}`
      : `No context value found for key "${key}"`;

    const reasonInfo = reason ? `\nReason for retrieval: ${reason}` : '';

    // Return the action result with context information
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `${contextInfo}${reasonInfo}`,
            functionCalls: [pullAppContextCall],
          },
          user: {
            type: 'user',
            text: 'Context retrieved successfully.',
            functionResponses: [
              {
                name: 'pullAppContext',
                call_id: pullAppContextCall.id,
                content: JSON.stringify({ contextKey: key, contextValue, reason, operation: 'get' }),
              },
            ],
            data: {
              contextKey: key,
              contextValue: contextValue,
              reason,
              operation: 'get',
            },
          },
        },
      ],
    };
  } catch (error) {
    // Handle any errors that occur during context retrieval
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    putSystemMessage(`Error retrieving context: ${errorMessage}`);

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `Failed to retrieve context for key "${key}": ${errorMessage}`,
          },
          user: {
            type: 'user',
            text: 'Context retrieval failed.',
            data: {
              contextKey: key,
              error: errorMessage,
              reason,
              operation: 'get',
            },
          },
        },
      ],
    };
  }
}
