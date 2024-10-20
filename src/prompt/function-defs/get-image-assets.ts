import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for getImageAssets
 */
export const getImageAssets: FunctionDef = {
  name: 'getImageAssets',
  description:
    'This function returns a map of application image assets. This map contains absolute file path, and basic metadata information. It does not contain contents. Contents must be requested using dedicated tool.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        description: 'An array of absolute paths of files that should be used to provided context.',
        items: {
          type: 'string',
        },
      },
    },
    required: [],
  },
};
