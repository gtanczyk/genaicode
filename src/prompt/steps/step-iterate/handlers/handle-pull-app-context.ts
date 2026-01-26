import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getContextValue } from '../../../../main/common/app-context-bus.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionResult, ActionHandlerProps, PullAppContextArgs } from '../step-iterate-types.js';

registerActionHandler('pullAppContext', handlePullAppContext);

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
  const [pullAppContextCall] = (
    await generateContentFn(
      prompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'pullAppContext',
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
    .map((item) => item.functionCall) as [FunctionCall<PullAppContextArgs> | undefined];

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

    putSystemMessage('Context retrieved successfully', {
      contextKey: key,
      contextValue: contextValue,
      reason,
      operation: 'get',
    });

    prompt.push(
      {
        type: 'assistant',
        text: `${contextInfo}${reasonInfo}`,
        functionCalls: [pullAppContextCall],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'pullAppContext',
            call_id: pullAppContextCall.id,
            content: JSON.stringify({ contextKey: key, contextValue, reason, operation: 'get' }),
          },
        ],
      },
    );

    // Return the action result with context information
    return {
      breakLoop: false,
      items: [],
    };
  } catch (error) {
    // Handle any errors that occur during context retrieval
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    putSystemMessage(`Error retrieving context`, {
      contextKey: key,
      error: errorMessage,
      reason,
      operation: 'get',
    });

    prompt.push(
      {
        type: 'assistant',
        text: `Failed to retrieve context for key "${key}": ${errorMessage}`,
      },
      {
        type: 'user',
        text: 'Context retrieval failed.',
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }
}
