import { FunctionDef } from '../../ai-service/common-types.js';

export type AllowedDockerImage =
  | 'ubuntu:latest'
  | 'ubuntu:22.04'
  | 'ubuntu:20.04'
  | 'alpine:latest'
  | 'alpine:3.18'
  | 'node:latest'
  | 'node:18'
  | 'node:20'
  | 'python:latest'
  | 'python:3.11'
  | 'python:3.12'
  | 'ghcr.io/puppeteer/puppeteer:latest';

export const runContainerTaskDef: FunctionDef = {
  name: 'runContainerTask',
  description: `Asks user for confirmation, and if confirmed executes a multi-step task safely in a sandboxed Docker container. It starts a a new container in clean state. 
Current project files are NOT automatically available in the container, you need to copy them explicitly if needed. 
You can run multiple commands in the container to accomplish the task. Outcomes can be copied back to the current project on the host machine.`,
  parameters: {
    type: 'object',
    properties: {
      image: {
        type: 'string',
        enum: [
          'ubuntu:latest',
          'ubuntu:22.04',
          'ubuntu:20.04',
          'alpine:latest',
          'alpine:3.18',
          'node:latest',
          'node:18',
          'node:20',
          'python:latest',
          'python:3.11',
          'python:3.12',
          'ghcr.io/puppeteer/puppeteer:latest',
        ],
        description: 'The Docker image to use from the allowed list.',
      },
      taskDescription: {
        type: 'string',
        description: `A detailed, natural language description of the entire task to be performed. This guides the command execution loop.
It is important to provide as much context as possible to ensure successful execution.
When a task requires current project files to be included, you must explicitly state this in the task description.`,
      },
      workingDir: {
        type: 'string',
        description: `Path of the working directory inside the container, which will be created if it doesn't exist.`,
      },
    },
    required: ['image', 'taskDescription', 'workingDir'],
  },
};

/**
 * Arguments for the runContainerTask action
 */
export type RunContainerTaskArgs = {
  image: AllowedDockerImage;
  taskDescription: string;
  workingDir: string;
};
