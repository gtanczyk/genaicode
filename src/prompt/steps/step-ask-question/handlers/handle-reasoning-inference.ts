import { FunctionCall, ModelType } from '../../../../ai-service/common.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  ActionResult,
  ActionHandlerProps,
  ReasoningInferenceArgs,
  ReasoningInferenceResponseArgs,
} from '../step-ask-question-types.js';

/**
 * Handler for the reasoningInference action.
 * This handler is designed to work with models that don't support function calling
 * but provide reasoning tokens along with their responses.
 */
export async function handleReasoningInference({
  askQuestionCall,
  prompt,
  generateContentFn,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    putSystemMessage('Reasoning inference: generating prompt');
    const [reasoningInferenceCall] = (await generateContentFn(
      prompt,
      getFunctionDefs(),
      'reasoningInference',
      0.7,
      true,
      options,
    )) as [FunctionCall<ReasoningInferenceArgs> | undefined];

    if (!reasoningInferenceCall?.args) {
      putSystemMessage('Failed to get valid reasoningInference request');
      return { breakLoop: false, items: [] };
    }

    putSystemMessage('Reasoning inference: calling reasoning model', reasoningInferenceCall.args);
    // Call the reasoning model with appropriate settings
    const [reasoningInferenceResponseCall] = (await generateContentFn(
      [
        {
          type: 'user',
          text:
            reasoningInferenceCall.args.prompt +
            (reasoningInferenceCall.args.contextPaths?.length > 0
              ? '\n\nContents of relevant files:\n' +
                Object.entries(
                  getSourceCode(
                    {
                      filterPaths: reasoningInferenceCall.args.contextPaths,
                      forceAll: true,
                      ignoreImportantFiles: true,
                    },
                    options,
                  ),
                )
                  .map(([path, file]) =>
                    'content' in file && file.content ? `File: ${path}\n\`\`\`${file.content}\`\`\`` : '',
                  )
                  .filter(Boolean)
                  .join('\n\n')
              : ''),
        },
      ],
      [],
      'reasoningInferenceResponse',
      0.7,
      ModelType.REASONING,
      options,
    )) as [FunctionCall<ReasoningInferenceResponseArgs>];

    putSystemMessage('Reasoning inference: received response', reasoningInferenceResponseCall.args);

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
        functionCalls: [reasoningInferenceCall],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'reasoningInference',
            call_id: reasoningInferenceCall.id,
            content: reasoningInferenceResponseCall.args?.response,
          },
        ],
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  } catch (error) {
    // Handle errors gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during reasoning inference: ${errorMessage}`);

    // Create error response items
    const assistantItem = {
      type: 'assistant' as const,
      text: 'An error occurred during reasoning inference.',
    };

    const userItem = {
      type: 'user' as const,
      text: 'Please try again or use a different approach.',
      data: {
        error: errorMessage,
      },
    };

    return {
      breakLoop: true,
      items: [{ assistant: assistantItem, user: userItem }],
    };
  }
}
