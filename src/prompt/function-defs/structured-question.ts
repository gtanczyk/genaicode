import { FunctionDef } from '../../ai-service/common-types.js';

export const structuredQuestionDef: FunctionDef = {
  name: 'structuredQuestion',
  description:
    'Present a structured form with multiple input types (checkboxes, radio buttons, selects, text fields, etc.) to collect user input.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Main question/prompt for the user',
      },
      form: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['text', 'checkbox', 'radio', 'select', 'textarea', 'number', 'email'],
                },
                required: { type: 'boolean' },
                placeholder: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                      label: { type: 'string' },
                    },
                    required: ['value', 'label'],
                  },
                },
                defaultValue: {
                  oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                },
                validation: {
                  type: 'object',
                  properties: {
                    pattern: { type: 'string' },
                    minLength: { type: 'number' },
                    maxLength: { type: 'number' },
                  },
                },
              },
              required: ['id', 'label', 'type'],
            },
          },
          submitLabel: { type: 'string' },
          cancelLabel: { type: 'string' },
        },
        required: ['title', 'fields'],
      },
    },
    required: ['message', 'form'],
  },
};
