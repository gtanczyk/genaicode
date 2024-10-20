import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for imglyRemoveBackground
 */
export const imglyRemoveBackgroundDef: FunctionDef = {
  name: 'imglyRemoveBackground',
  description: 'Removes background from an image using @imgly/background-removal-node',
  parameters: {
    type: 'object',
    properties: {
      inputFilePath: {
        type: 'string',
        description: 'The file path of the input image.',
      },
      outputFilePath: {
        type: 'string',
        description: 'The file path to save the output image with removed background.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind removing the background from this image',
      },
    },
    required: ['inputFilePath', 'outputFilePath'],
  },
};

export type ImglyRemoveBackgroundArgs = {
  inputFilePath: string;
  outputFilePath: string;
  explanation?: string;
};
