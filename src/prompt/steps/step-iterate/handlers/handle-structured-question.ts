import {
  ActionHandler,
  ActionHandlerProps,
  ActionResult,
  IterateCall,
  StructuredQuestionArgs,
} from '../step-iterate-types.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { askUserForStructuredQuestion } from '../../../../main/common/user-actions.js';
import {
  GenerateContentArgs,
  GenerateContentFunction,
  FunctionCall,
  ModelType,
  PromptItem,
} from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

async function handleStructuredQuestion({
  iterateCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const structuredQuestionCall = await generateStructuredQuestionCall(
    generateContentFn,
    prompt,
    iterateCall,
    options,
    ModelType.CHEAP,
  );

  putSystemMessage('Presenting structured question', { ...structuredQuestionCall?.args });

  if (!structuredQuestionCall?.args) {
    return {
      breakLoop: false,
      items: [],
    };
  }

  const userResponse = await askUserForStructuredQuestion(structuredQuestionCall.args.form, options);

  putSystemMessage('Received structured question response', { ...userResponse });

  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: structuredQuestionCall.args?.message ?? 'Please complete the form.',
          functionCalls: [structuredQuestionCall],
        },
        user: {
          type: 'user',
          functionResponses: [
            {
              name: 'structuredQuestion',
              call_id: structuredQuestionCall.id,
              content: JSON.stringify(userResponse),
            },
          ],
        },
      },
    ],
  };
}

async function generateStructuredQuestionCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  iterateCall: IterateCall,
  options: CodegenOptions,
  modelType: ModelType,
): Promise<FunctionCall<StructuredQuestionArgs> | undefined> {
  const req: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args?.message ?? 'I need to ask a structured question.',
      },
      {
        type: 'user',
        text: 'Yes, you can ask the structured question.',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'structuredQuestion',
      temperature: 0.7,
      modelType,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];
  const [structuredQuestionCall] = (await generateContentFn(...req))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<StructuredQuestionArgs> | undefined];

  return structuredQuestionCall;
}

registerActionHandler('structuredQuestion', handleStructuredQuestion as ActionHandler);
