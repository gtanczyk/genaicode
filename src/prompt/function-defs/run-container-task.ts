import { FunctionDef } from '../../ai-service/common-types.js';

export const runContainerTaskDef: FunctionDef = {
  name: 'runContainerTask',
  description: 'Executes a multi-step task safely in a sandboxed Docker container.',
  parameters: {
    type: 'object',
    properties: {
      image: {
        type: 'string',
        description: 'The Docker image to use (e.g., "ubuntu:latest").',
      },
      taskDescription: {
        type: 'string',
        description:
          'A detailed, natural language description of the entire task to be performed. This guides the command execution loop.',
      },
    },
    required: ['image', 'taskDescription'],
  },
};
