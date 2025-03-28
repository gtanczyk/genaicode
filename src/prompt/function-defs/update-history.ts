import { FunctionDef } from '../../ai-service/common-types';

/**
 * Function definition for updateHistory
 */
export const updateHistory: FunctionDef = {
  name: 'updateHistory',
  description: 'Update the history.',
  parameters: {
    type: 'object',
    properties: {
      recentConversationSummary: {
        type: 'string',
        description: 'Summary of recent conversation',
      },
      newHistoryContent: {
        type: 'string',
        description: 'The new history content, combination of recent conversation summary, and current history',
      },
    },
    required: ['recentConversationSummary', 'newHistoryContent'],
  },
};
