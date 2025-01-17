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
        description: 'A step by step plan of code changes necessary to solve the problem.',
      },
      affectedFiles: {
        type: 'array',
        description: 'A list of all files that need to be modified. The reason must precede the file path.',
        items: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Reason for modifying this file.',
            },
            filePath: {
              type: 'string',
              description: 'Absolute path of the file.',
            },
            dependencies: {
              type: 'array',
              description: 'Related files that depend on or are depended upon by this file.',
              items: {
                type: 'string',
              },
            },
            fileSize: {
              type: 'string',
              description: 'The approximate size of the file (in lines of code or tokens)',
              enum: ['small', 'medium', 'large', 'n/a'],
            },
            changeComplexity: {
              type: 'string',
              description: 'Describes how complex the required changes to this file will be.',
              enum: ['trivial', 'simple', 'medium', 'complex', 'refactor', 'n/a'],
            },
          },
          required: ['reason', 'filePath'],
        },
      },
    },
    required: ['problemAnalysis', 'codeChanges', 'affectedFiles'],
  },
});
