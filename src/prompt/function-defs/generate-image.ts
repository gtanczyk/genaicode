import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for generateImage
 */
export const generateImage: FunctionDef = {
  name: 'generateImage',
  description: 'Generate an image using AI service and save it as a file.',
  parameters: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind generating this image',
      },
      prompt: {
        type: 'string',
        description:
          'The prompt that will be used to generate the image. This prompt must be detailed, it will be used by image generation model.',
      },
      filePath: {
        type: 'string',
        description: 'The file path to save the generated image.',
      },
      contextImagePath: {
        type: 'string',
        description:
          'Path to a image file that will be used as a context for image generation. It is useful if there is a need to edit an image with genAI.',
      },
      width: {
        type: 'number',
        description: 'width of the image',
      },
      height: {
        type: 'number',
        description: 'height of the image',
      },
      cheap: {
        type: 'boolean',
        description:
          'true value means that the prompt will be executed with cheaper model, which work faster, but provides lower quality results, so please use it only in situation when lower quality results are acceptable for the prompt.',
      },
    },
    required: ['prompt', 'filePath', 'width', 'height'],
  },
};
