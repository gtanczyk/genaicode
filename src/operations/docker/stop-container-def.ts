import { FunctionDef } from '../../ai-service/common-types.js';

/**
 * The function definition for the 'stopContainer' operation.
 */
export const stopContainerDef: FunctionDef = {
  name: 'stopContainer',
  description: 'Stops and removes a running Docker container.',
  parameters: {
    type: 'object',
    properties: {
      containerId: {
        type: 'string',
        description: 'The ID of the container to stop.',
      },
    },
    required: ['containerId'],
  },
};
