import { FunctionDef } from '../../ai-service/common.js';

/**
 * Function definition for retrieving help documentation from GenAIcode.
 * This function is used by the help action handler to search and retrieve relevant documentation.
 */
export const genaicodeHelpDef: FunctionDef = {
  name: 'genaicodeHelp',
  description: `This function provides help to the user on how to use GenAIcode. The response will be grounded in the content of GenAIcode's documentation.`,
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description:
          'Step by step thinking process starting from the problem statement, going through the thought process, and ending with potentially a solution to the user problem.',
      },
      message: {
        type: 'string',
        description:
          'A message that will be displayed to the user as a result of the reasoning process and help action.',
      },
    },
    required: ['reasoning', 'message'],
  },
};
