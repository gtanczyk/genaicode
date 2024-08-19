/**
 * Function definition for resizeImage
 */
export const resizeImage = {
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
        description: 'The explanation of the reasoning behind removing the background from this image',
      },
    },
    required: ['filePath', 'size'],
  },
} as const;
