import { FunctionDef } from '../../ai-service/common-types';

export const reasoningInference: FunctionDef = {
  name: 'reasoningInference',
  description: `This function performs a reasoning inference. It must be called with a prompt, which is detailed and exhaustive. The inference will be supplied only with this prompt, and will not contain any other context.
It must also be called with a list of context items, which are key-value pairs that provide additional context to the inference. The context items should be relevant to the prompt, and should be used to help the inference make more accurate predictions.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: `The string that contains the prompt. The prompt should be detailed and exhaustive. It should contain all relevant information that the inference model will need to make accurate predictions.`,
      },
      contextPaths: {
        type: 'array',
        description:
          'An array of absolute file paths that should be used to provide context for the reasoning inference.',
        items: {
          type: 'string',
        },
      },
    },
    required: ['prompt', 'contextPaths'],
  },
};

export const reasoningInferenceResponse: FunctionDef = {
  name: 'reasoningInferenceResponse',
  description: 'Reasoning inference response',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
      },
      response: {
        type: 'string',
      },
    },
    required: ['response'],
  },
};
