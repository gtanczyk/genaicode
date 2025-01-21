import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for resizeImage
 */
export const resizeImageDef: FunctionDef = {
  name: 'resizeImage',
  description: 'Resize image to the desired size',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file path of the image.',
      },
      size: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'width of the image',
          },
          height: {
            type: 'number',
            description: 'height of the image',
          },
        },
        required: ['width', 'height'],
        description: 'The size of the image to generate.',
      },
      explanation: {
        type: 'string',
        description: 'The explanation of the reasoning behind resizing this image',
      },
    },
    required: ['filePath', 'size'],
  },
};

export type ResizeImageArgs = {
  filePath: string;
  size: {
    width: number;
    height: number;
  };
  explanation?: string;
};
