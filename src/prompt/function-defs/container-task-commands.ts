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

// Optional tools that LLM can use for planning when helpful
export const analyzeTaskDef: FunctionDef = {
  name: 'analyzeTask',
  description: 'Analyze task requirements and document your understanding (optional, use when helpful).',
  parameters: {
    type: 'object',
    properties: {
      analysis: {
        type: 'string',
        description: 'Your analysis of what needs to be accomplished.',
      },
      approach: {
        type: 'string',
        description: 'Your planned approach for the task.',
      },
    },
    required: ['analysis', 'approach'],
  },
};

export const planStepsDef: FunctionDef = {
  name: 'planSteps',
  description: 'Create or update an execution plan (optional, use when helpful).',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'Your step-by-step plan for completing the task.',
      },
    },
    required: ['plan'],
  },
};
