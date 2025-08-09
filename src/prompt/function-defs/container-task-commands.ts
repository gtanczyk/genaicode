import { FunctionDef } from '../../ai-service/common-types.js';

export const runCommandDef: FunctionDef = {
  name: 'runCommand',
  description: 'Execute a shell command in the Docker container.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute in the container.',
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of why this command is needed for the task.',
      },
    },
    required: ['command', 'reasoning'],
  },
};

export const completeTaskDef: FunctionDef = {
  name: 'completeTask',
  description: 'Mark the container task as successfully completed.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of what was accomplished.',
      },
    },
    required: ['summary'],
  },
};

export const failTaskDef: FunctionDef = {
  name: 'failTask',
  description: 'Mark the container task as failed.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Explanation of why the task failed.',
      },
    },
    required: ['reason'],
  },
};
