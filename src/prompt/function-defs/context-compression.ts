import { FunctionCall, FunctionDef } from '../../ai-service/common-types.js';

/**
 * Function definition for compressContext
 *
 * This function performs intelligent context compression by analyzing both conversation
 * history and source code dependencies. It aims to reduce token usage while maintaining
 * essential information required for high-quality code generation.
 *
 * The compression process:
 * 1. Analyzes conversation history to identify high, medium, and optional priority information
 * 2. Deduplicates redundant information while preserving context
 * 3. Identifies and includes critical file paths based on specific criteria
 * 4. Maintains chronological progression of important decisions
 * 5. Preserves technical details and implementation status
 */
export const compressContext: FunctionDef = {
  name: 'compressContext',
  description:
    'Use this function to compress the context by analyzing both conversation history and source code dependencies. ' +
    'The function returns a compressed version of the conversation that maintains essential information while reducing tokens. ' +
    'It prioritizes information (High/Medium/Optional), deduplicates content, and carefully manages file path inclusion.',
  parameters: {
    type: 'object',
    properties: {
      conversationSummary: {
        type: 'string',
        description:
          'A concise summary of the conversation history, preserving high-priority information ' +
          '(core requirements, expensive operations results, key decisions), medium-priority items ' +
          '(important clarifications, preferences), and optional details when relevant. ' +
          'The summary should maintain chronological order and technical accuracy.',
      },
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'List of file paths that are essential for the code generation task. Include:\n' +
          '- Files directly involved in code changes\n' +
          '- Files containing analyzed or discussed code\n' +
          '- Critical dependencies of modified files\n' +
          '- Configuration files affecting changes\n' +
          'Exclude:\n' +
          '- Files only mentioned in passing\n' +
          '- Files from rejected approaches\n' +
          '- Files outside current task scope',
      },
    },
    required: ['conversationSummary', 'filePaths'],
  },
};

/**
 * Type definition for context compression arguments.
 * These arguments control how the conversation context and source code dependencies
 * are compressed and managed.
 */
export type ContextCompressionArgs = {
  /**
   * A concise summary of the key points from the conversation history.
   * The summary should:
   * - Preserve high-priority information (requirements, decisions, analysis results)
   * - Include relevant medium-priority items (clarifications, preferences)
   * - Maintain chronological order of important events
   * - Keep technical accuracy and context
   */
  conversationSummary: string;

  /**
   * List of file paths that are essential for the code generation task.
   * The list should include:
   * - Files directly targeted for modification
   * - Files containing code being analyzed
   * - Critical dependencies of modified files
   * - Configuration files affecting the changes
   * But exclude:
   * - Files only mentioned in passing
   * - Files from rejected approaches
   * - Files outside the current task scope
   */
  filePaths?: string[];
};

/** Type for function calls with context compression arguments */
export type ContextCompressionCall = FunctionCall<ContextCompressionArgs>;
