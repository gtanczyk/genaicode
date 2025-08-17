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
  description: 'Executes a multi-step task safely in a sandboxed Docker container.',
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
        description:
          'A detailed, natural language description of the entire task to be performed. This guides the command execution loop.',
      },
    },
    required: ['image', 'taskDescription'],
  },
};

/**
 * Arguments for the runContainerTask action
 */
export type RunContainerTaskArgs = {
  image: AllowedDockerImage;
  taskDescription: string;
};
