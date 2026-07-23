import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { fromOpenAICompletion, toOpenAIMessages, toOpenAIRequest } from './openai-converter.js';

describe('OpenAI converter', () => {
  it('converts multimodal prompts and tool round trips', () => {
    const messages = toOpenAIMessages([
      { type: 'systemPrompt', systemPrompt: 'rules' },
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
    ]);

    expect(messages).toMatchObject([
      { role: 'system', content: 'rules' },
      { role: 'assistant', tool_calls: [{ id: 'call-1', function: { name: 'lookup' } }] },
      { role: 'tool', tool_call_id: 'call-1' },
      { role: 'user', content: 'continue' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ],
      },
    ]);
  });

  it('converts request options and normalized results', () => {
    expect(
      toOpenAIRequest(
        {
          prompt: [{ type: 'user', text: 'hello' }],
          tools: [{ name: 'answer', description: 'Answer', parameters: { type: 'object' } }],
          toolChoice: { name: 'answer' },
        },
        'model-a',
      ),
    ).toMatchObject({
      model: 'model-a',
      tool_choice: { type: 'function', function: { name: 'answer' } },
    });

    const completion = {
      id: 'completion-1',
      object: 'chat.completion',
      created: 0,
      model: 'model-a',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          message: {
            role: 'assistant',
            content: 'done',
            refusal: null,
            tool_calls: [
              {
                type: 'function',
                id: 'call-1',
                function: { name: 'answer', arguments: '{"value":42}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as OpenAI.Chat.Completions.ChatCompletion;

    expect(fromOpenAICompletion(completion)).toMatchObject({
      model: 'model-a',
      finishReason: 'tool_calls',
      parts: [
        { type: 'text', text: 'done' },
        { type: 'toolCall', toolCall: { id: 'call-1', name: 'answer', arguments: { value: 42 } } },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });
});
