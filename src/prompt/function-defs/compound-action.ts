import { FunctionDef } from '../../ai-service/common-types.js';
import { getOperationDefs } from '../../operations/operations-index.js';

export const getCompoundActionDef: () => FunctionDef = () => ({
  name: 'compoundAction',
  description: 'Infers the types of actions required and a summary for user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        description: 'An array of action names (e.g., createFile, updateFile) to be performed.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'A unique identifier for the action.',
            },
            name: {
              type: 'string',
              description: 'The name of the action to be performed.',
              enum: getOperationDefs().map((op) => op.name),
            },
            dependsOn: {
              type: 'array',
              description: 'An array of action IDs that this action depends on.',
              items: {
                type: 'string',
                description: 'The ID of a dependent action.',
              },
            },
            filePath: {
              type: 'string',
              description: 'The absolute path of the file to be acted upon, if applicable.',
            },
          },
          required: ['id', 'name', 'filePath'],
        },
      },
      summary: {
        type: 'string',
        description: 'A user-facing summary of the proposed actions, asking for confirmation.',
      },
    },
    required: ['actions', 'summary'],
  },
});
