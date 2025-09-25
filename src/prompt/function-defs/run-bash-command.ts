import { FunctionDef } from '../../ai-service/common-types.js';
import { rcConfig } from '../../main/config.js';

export const getRunBashCommandDef = (): FunctionDef => {
  return {
    name: 'runBashCommand',
    description: `Execute a bash command. Supports passing args and env.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute.' },
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
          enum: ['first', 'last', 'summarize', 'full'],
          description:
            "How to truncate the command output if it is too long. `first` uses the first 200 lines/1000 chars, `last` uses the last 200 lines/1000 chars, `summarize` uses a lite model to summarize. 'full' will return the full output.",
        },
        explanation: { type: 'string', description: 'An explanation for why this command is being run.' },
      },
      required: ['command'],
    },
  };
};
