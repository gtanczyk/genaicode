import { FunctionDef } from '../../ai-service/common.js';

/**
 * Function definition for analysisResult operation.
 * This function is called to return the results of analysis performed by performAnalysis.
 * It includes both user-friendly message and detailed analysis data.
 */
export const analysisResult: FunctionDef = {
  name: 'analysisResult',
  description: 'Returns the results of analysis performed by performAnalysis function.',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: "The reasoning behind the analysis results. This won't be displayed to the user.",
      },
      message: {
        type: 'string',
        description:
          'A user-friendly message that summarizes the analysis results. This will be displayed to the user.',
      },
    },
    required: ['reasoning', 'message'],
  },
};
