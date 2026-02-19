import { FunctionDef } from '../../ai-service/common-types';

export const codeExecutionDef: FunctionDef = {
  name: 'codeExecution',
  description: `Infers the parameters needed to perform AI-driven code execution.
The inferred parameters are not displayed to the user. They are used to inform the actual code execution step.`,
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'The file paths from the project that need to be uploaded for code execution.',
      },
      objective: {
        type: 'string',
        description: 'A clear description of what the code should accomplish.',
      },
      desiredResult: {
        type: 'string',
        description: 'A description of the expected output or result of the execution.',
      },
    },
    required: ['filePaths', 'objective', 'desiredResult'],
  },
};

export type CodeExecutionInferArgs = {
  filePaths: string[];
  objective: string;
  desiredResult: string;
};
