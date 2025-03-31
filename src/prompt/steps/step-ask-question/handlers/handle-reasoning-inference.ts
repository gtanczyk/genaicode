import { FunctionCall, GenerateContentArgs } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  ActionResult,
  ActionHandlerProps,
  ReasoningInferenceResponseArgs,
  ReasoningInferenceCall,
} from '../step-ask-question-types.js';
import { getContextSourceCode } from '../../../../files/source-code-utils.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

registerActionHandler('reasoningInference', handleReasoningInference);

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

    const request: GenerateContentArgs = [
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'reasoningInference',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    ];

    const [reasoningInferenceCall] = (await generateContentFn(...request))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [ReasoningInferenceCall | undefined];

    if (!reasoningInferenceCall?.args?.prompt) {
      putSystemMessage('Failed to get valid reasoningInference request');
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'Failed to get valid reasoningInference request',
        },
      );
      return { breakLoop: false, items: [] };
    }

    putSystemMessage('Reasoning inference: calling reasoning model', reasoningInferenceCall.args);

    // Get expanded context using getContextSourceCode
    const contextPaths = reasoningInferenceCall.args.contextPaths || [];
    const expandedContextSourceCodeMap = getContextSourceCode(contextPaths, options);

    // Call the reasoning model with appropriate settings
    const [reasoningInferenceResponseCall] = (
      await generateContentFn(
        [
          {
            type: 'user',
            text:
              reasoningInferenceCall.args.prompt +
              (Object.keys(expandedContextSourceCodeMap).length > 0
                ? '\n\nContents of relevant files:\n' +
                  Object.entries(expandedContextSourceCodeMap)
                    .map(([path, file]) =>
                      'content' in file && file.content ? `File: ${path}\n\`\`\`${file.content}\`\`\`` : '',
                    )
                    .filter(Boolean)
                    .join('\n\n')
                : ''),
          },
        ],
        {
          functionDefs: [],
          requiredFunctionName: 'reasoningInferenceResponse',
          temperature: 0.7,
          modelType: ModelType.REASONING,
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
      .map((item) => item.functionCall) as [FunctionCall<ReasoningInferenceResponseArgs>];

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

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: `Error during reasoning inference.`,
      },
    );

    return {
      // TODO: rather do a retry here?
      breakLoop: true,
      items: [],
    };
  }
}
