/**
 * Function definition for updateIdentity
 */
export const updateIdentity = {
  name: 'updateIdentity',
  description: 'Update the identity.',
  parameters: {
    type: 'object',
    properties: {
      recentConversationSummary: {
        type: 'string',
        description: 'Summary of recent conversation',
      },
      newIdentityContent: {
        type: 'string',
        description: 'The new identity content, combination of recent conversation summary, and current identity',
      },
    },
    required: ['recentConversationSummary', 'newIdentityContent'],
  },
} as const;
