import { FunctionDef } from '../../ai-service/common.js';

/**
 * Function definition for performAnalysis operation.
 * This function is called when there's a need to perform complex analysis
 * of code, data, or other content that requires enhanced context or
 * more expensive computation.
 */
export const performAnalysis: FunctionDef = {
  name: 'performAnalysis',
  description: `Perform analysis of complex problems or data that requires enhanced context or more expensive computation.
The \`prompt\` parameter must contain a detailed description of the analysis to perform and how to perform it.
`,
  parameters: {
    type: 'object',
    properties: {
      analysisType: {
        type: 'string',
        enum: ['code', 'image', 'security', 'performance', 'architecture', 'general'],
        description: 'The type of analysis to perform. This helps in optimizing the analysis process and results.',
      },
      prompt: {
        type: 'string',
        description: 'The analysis prompt that describes in detail what needs to be analyzed and how.',
      },
    },
    required: ['analysisType', 'prompt'],
  },
};
