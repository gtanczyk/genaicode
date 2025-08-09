import { FunctionDef } from '../../ai-service/common-types.js';

export const analyzeTaskDef: FunctionDef = {
  name: 'analyzeTask',
  description: 'Analyze the task requirements and understand what needs to be accomplished.',
  parameters: {
    type: 'object',
    properties: {
      analysis: {
        type: 'string',
        description: 'Detailed analysis of what needs to be accomplished.',
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'medium', 'complex'],
        description: 'Assessment of task complexity level.',
      },
      approach: {
        type: 'string',
        description: 'Initial high-level strategy for accomplishing the task.',
      },
    },
    required: ['analysis', 'complexity', 'approach'],
  },
};

export const planStepsDef: FunctionDef = {
  name: 'planSteps',
  description: 'Create a detailed step-by-step execution plan for the task.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            phase: {
              type: 'string',
              enum: ['orientation', 'preparation', 'execution', 'verification'],
              description: 'The execution phase for this step.',
            },
            commands: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of commands to execute in this step.',
            },
            rationale: {
              type: 'string',
              description: 'Explanation of why this step is necessary.',
            },
            riskLevel: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Risk assessment for this step.',
            },
          },
          required: ['phase', 'commands', 'rationale', 'riskLevel'],
        },
        description: 'Ordered list of execution steps.',
      },
    },
    required: ['steps'],
  },
};

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
      phase: {
        type: 'string',
        enum: ['orientation', 'preparation', 'execution', 'verification'],
        description: 'The execution phase this command belongs to.',
      },
      expectedOutcome: {
        type: 'string',
        description: 'What this command is expected to achieve.',
      },
      fallbackCommand: {
        type: 'string',
        description: 'Alternative command to try if this one fails.',
      },
    },
    required: ['command', 'reasoning', 'phase', 'expectedOutcome'],
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
