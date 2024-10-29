import { FunctionDef } from '../../ai-service/common';

/**
 * Function definition for optimizeContext
 */
export const optimizeContext: FunctionDef = {
  name: 'optimizeContext',
  description: `This function helps prioritize files based on their importance to the user prompt.

Example:
1. User prompt: "I want to add a new test to util unit tests."
2. Assistant makes a function call for \`getSourceCode\` to get the source code.
3. User provides the source code in \`getSourceCode\` function response:
\`\`\`
{
  '/path/to/directory': {
    'something.js': ['console.log('Hello, World!');'],
  },
  '/path/to/directory/sub1/sub2': {
    'util-tests.js': [null, 'This file contains unit tests.'],
  }
}
\`\`\`
4. Assistant calls the \`optimizeContext\` function to narrow the context to relevant files:
\`\`\`
{
  userPrompt: "I want to add a new test to util unit tests.",
  optimizedContext: [
    {
      filePath: '/path/to/directory/sub1/sub2/util-tests.js',
      relevance: 0.8,
    },
    {
      filePath: '/path/to/directory/something.js',
      relevance: 0.2,
    }
  ]
\`\`\`

This means that the file \`something.js\` file is less relevant to the user prompt, and \`util-tests.js\` is more relevant.`,
  parameters: {
    type: 'object',
    properties: {
      userPrompt: {
        type: 'string',
        description: "The user's original prompt.",
      },
      optimizedContext: {
        type: 'array',
        description: 'An array of objects representing relevant files, their relevance scores, and token counts.',
        items: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'The absolute file path of a relevant file.',
            },
            relevance: {
              type: 'number',
              description: 'A score from 0 to 1 indicating the relevance of the file to the user prompt.',
              minimum: 0,
              maximum: 1,
            },
          },
          required: ['filePath', 'relevance'],
        },
      },
    },
    required: ['userPrompt', 'optimizedContext'],
  },
};
