import { FunctionDef } from '../../ai-service/common-types.js';

export const runProjectCommandDef: FunctionDef = {
  name: 'runProjectCommand',
  description:
    'Execute a named project command (from .genaicoderc projectCommands or auto-discovered package.json scripts). Supports passing args and env.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name of the project command to execute.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Optional arguments to pass to the command.' },
      env: {
        type: 'object',
        description: 'Optional environment variables to set for the command.',
      },
      workingDirOverride: {
        type: 'string',
        description: 'Optional override for the working directory to run the command in.',
      },
      explanation: { type: 'string', description: 'An explanation for why this command is being run.' },
    },
    required: ['name'],
  },
};
