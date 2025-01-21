import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for splitImage
 */
export const splitImageDef: FunctionDef = {
  name: 'splitImage',
  description: 'Split an image into multiple parts and save them as separate files.',
  parameters: {
    type: 'object',
    properties: {
      inputFilePath: {
        type: 'string',
        description: 'The file path of the input image to be split.',
      },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rect: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'The x-coordinate of the top-left corner of the rectangle.' },
                y: { type: 'number', description: 'The y-coordinate of the top-left corner of the rectangle.' },
                width: { type: 'number', description: 'The width of the rectangle.' },
                height: { type: 'number', description: 'The height of the rectangle.' },
              },
              required: ['x', 'y', 'width', 'height'],
            },
            outputFilePath: {
              type: 'string',
              description: 'The file path to save the extracted part of the image.',
            },
          },
          required: ['rect', 'outputFilePath'],
        },
        description: 'An array of parts to extract from the image, each with a rectangle and output file path.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind splitting this image',
      },
    },
    required: ['inputFilePath', 'parts'],
  },
};

export type SplitImageArgs = {
  inputFilePath: string;
  parts: Array<{
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    outputFilePath: string;
  }>;
  explanation?: string;
};
