import type { PromptItem, ToolDefinition } from '../../core/types.js';

/** Shared multimodal + tool-call prompt used by converter contract tests. */
export const multimodalToolRoundTripPrompt: PromptItem[] = [
  { type: 'systemPrompt', systemPrompt: 'Return captions and call tools when needed.' },
  {
    type: 'assistant',
    text: 'checking',
    toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { id: 7 } }],
  },
  {
    type: 'user',
    toolResults: [{ callId: 'call-1', name: 'lookup', content: '{"ok":true}' }],
    text: 'continue',
  },
  {
    type: 'user',
    text: 'caption',
    images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }],
  },
];

export const sampleTools: ToolDefinition[] = [
  {
    name: 'lookup',
    description: 'Look up a record by id',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];
