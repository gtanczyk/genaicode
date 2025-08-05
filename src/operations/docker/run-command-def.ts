import { FunctionDef } from '../../ai-service/common-types.js';

/**
 * The function definition for the 'runCommand' operation.
 */
export const runCommandDef: FunctionDef = {
  name: 'runCommand',
  description: 'Runs a command inside a running Docker container and returns a summary of the output.',
  parameters: {
    type: 'object',
    properties: {
      containerId: {
        type: 'string',
        description: 'The ID of the container in which to run the command.',
      },
      cmd: {
        type: 'string',
        description: 'The command to execute inside the container (e.g., "ls -la").',
      },
    },
    required: ['containerId', 'cmd'],
  },
};
