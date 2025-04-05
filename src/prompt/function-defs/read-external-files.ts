import { FunctionDef } from '../../ai-service/common-types.js';

/**
 * Function definition for readExternalFiles
 *
 * Use this function to request access to read files located outside the project's root directory.
 * User confirmation is required for the batch of external files. Only processed information (summary or extracted facts)
 * will be returned, not the raw file content.
 */
export const readExternalFiles: FunctionDef = {
  name: 'readExternalFiles',
  description:
    "Use this function to request access to read files located outside the project's root directory. User confirmation is required for the batch of external files. Only processed information (summary or extracted facts) will be returned, not the raw file content.",
  parameters: {
    type: 'object',
    properties: {
      externalFilePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        minLength: 1,
        description: 'An array of absolute or relative file paths for the external files to read.',
      },
      reason: {
        type: 'string',
        description: 'The reason why access to these external files is needed for the current task.',
      },
    },
    required: ['externalFilePaths', 'reason'],
  },
};
