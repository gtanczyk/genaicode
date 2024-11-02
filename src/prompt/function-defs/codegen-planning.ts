import { FunctionDef } from '../../ai-service/common.js';

/**
 * Function definition for codegenPlanning
 * This function analyzes the conversation and produces a detailed implementation plan
 * before proceeding with actual code generation. This helps ensure all necessary files
 * are identified and dependencies are properly handled.
 */
export const getCodegenPlanningDef = (): FunctionDef => ({
  name: 'codegenPlanning',
  description:
    'Analyzes the conversation to produce an implementation plan, identifying all affected files and dependencies before code generation.',
  parameters: {
    type: 'object',
    properties: {
      problemAnalysis: {
        type: 'string',
        description: 'Detailed analysis of the problem.',
      },
      codeChanges: {
        type: 'string',
        description: 'A step by step plan of code changes neccessary to solve the problem.',
      },
      affectedFiles: {
        type: 'array',
        description: 'A list of all files that need to be modified.',
        items: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Absolute path of the file.',
            },
            reason: {
              type: 'string',
              description: 'Reason for modifying this file.',
            },
            dependencies: {
              type: 'array',
              description: 'Related files that depend on or are depended upon by this file.',
              items: {
                type: 'string',
              },
            },
          },
          required: ['filePath', 'reason'],
        },
      },
    },
    required: ['problemAnalysis', 'codeChanges', 'affectedFiles'],
  },
});
