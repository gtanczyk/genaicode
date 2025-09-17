import { FunctionDef } from '../../ai-service/common-types.js';
import { rcConfig } from '../../main/config.js';

export const getRunProjectCommandDef = (): FunctionDef => {
  const commands = rcConfig.projectCommands;
  const names = commands ? Object.keys(commands) : [];
  return {
    name: 'runProjectCommand',
    description: `Execute a named project command (from .genaicoderc projectCommands or auto-discovered package.json scripts). Supports passing args and env.

Supported commands:
${Object.entries(commands || {}).map(
  ([name, cmdDef]) => `
- ${name}: ${cmdDef.description || cmdDef.command}`,
)}
`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the project command to execute.', enum: names },
        args: { type: 'array', items: { type: 'string' }, description: 'Optional arguments to pass to the command.' },
        env: {
          type: 'object',
          description: 'Optional environment variables to set for the command.',
        },
        workingDirOverride: {
          type: 'string',
          description: `Optional override for the working directory to run the command in. If set then must be a project path (inside rootDir: ${rcConfig.rootDir}).`,
        },
        truncMode: {
          type: 'string',
          enum: ['first', 'last', 'summarize'],
          description: `How to truncate the command output if it is too long. \`first\` uses the first 200 lines/1000 chars, \`last\` uses the last 200 lines/1000 chars, \`summarize\` uses a lite model to summarize.`,
        },
        explanation: { type: 'string', description: 'An explanation for why this command is being run.' },
      },
      required: ['name'],
    },
  };
};
