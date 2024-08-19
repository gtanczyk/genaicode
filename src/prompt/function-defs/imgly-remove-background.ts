/**
 * Function definition for imglyRemoveBackground
 */
export const imglyRemoveBackground = {
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
} as const;
