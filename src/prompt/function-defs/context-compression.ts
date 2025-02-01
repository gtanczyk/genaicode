import { FunctionCall, FunctionDef } from '../../ai-service/common-types.js';

/**
 * Function definition for compressContext
 *
 * This function performs intelligent context compression by analyzing both conversation
 * history and source code dependencies. It aims to reduce token usage while maintaining
 * essential information required for high-quality code generation.
 */
export const compressContext: FunctionDef = {
  name: 'compressContext',
  description:
    'Use this function to compress the context by analyzing both conversation history and source code dependencies. ' +
    'The function returns a compressed version of the conversation that maintains essential information while reducing tokens.',
  parameters: {
    type: 'object',
    properties: {
      conversationSummary: {
        type: 'string',
        description: 'A concise summary of the key points from the conversation history.',
      },
      codegenIntent: {
        type: 'string',
        description: 'The identified primary intent or goal of the code generation task.',
      },
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'List of file paths that are essential for the code generation task.',
      },
    },
    required: ['conversationSummary', 'codegenIntent', 'filePaths'],
  },
};

/**
 * Type definition for context compression arguments.
 * These arguments control how the conversation context and source code dependencies
 * are compressed and managed.
 */
export type ContextCompressionArgs = {
  /** A concise summary of the key points from the conversation history */
  conversationSummary: string;

  /** The identified primary intent or goal of the code generation task */
  codegenIntent: string;

  /**
   * Optional list of file paths that are essential for the code generation task.
   * These files will be retained in the context even after compression.
   */
  filePaths?: string[];
};

/** Type for function calls with context compression arguments */
export type ContextCompressionCall = FunctionCall<ContextCompressionArgs>;
