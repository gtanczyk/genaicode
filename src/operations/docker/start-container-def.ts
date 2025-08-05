import { FunctionDef } from '../../ai-service/common-types.js';

/**
 * The function definition for the 'startContainer' operation.
 */
export const startContainerDef: FunctionDef = {
  name: 'startContainer',
  description: 'Starts a new Docker container from a specified image.',
  parameters: {
    type: 'object',
    properties: {
      image: {
        type: 'string',
        description: 'The Docker image to use for the container (e.g., "ubuntu:latest").',
      },
      name: {
        type: 'string',
        description: 'An optional name to assign to the container.',
      },
    },
    required: ['image'],
  },
};
