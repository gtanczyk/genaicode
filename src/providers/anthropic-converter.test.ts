import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  fromAnthropicMessage,
  toAnthropicMessages,
  toAnthropicRequest,
  toAnthropicSystem,
} from './anthropic-converter.js';

describe('Anthropic converter', () => {
  it('converts system caching, images, and tool round trips', () => {
    const prompt = [
      { type: 'systemPrompt' as const, systemPrompt: 'rules', cache: true },
      {
        type: 'assistant' as const,
        text: 'checking',
        toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { id: 7 } }],
      },
      {
        type: 'user' as const,
        text: 'continue',
        toolResults: [{ callId: 'call-1', name: 'lookup', content: '{"ok":true}' }],
        images: [{ mediaType: 'image/png' as const, data: 'aGVsbG8=' }],
      },
    ];

    expect(toAnthropicSystem(prompt)).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
    expect(toAnthropicMessages(prompt)).toMatchObject([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'call-1', name: 'lookup', input: { id: 7 } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
          { type: 'text', text: 'continue' },
        ],
      },
    ]);
  });

  it('maps request policy and normalizes responses', () => {
    const request = toAnthropicRequest(
      {
        prompt: [{ type: 'user', text: 'hello' }],
        tools: [{ name: 'answer', description: 'Answer', parameters: { type: 'object' } }],
        toolChoice: { name: 'answer' },
        thinking: { budgetTokens: 1024 },
      },
      { model: 'claude-test', maxOutputTokens: 4000 },
    );
    expect(request).toMatchObject({
      model: 'claude-test',
      max_tokens: 4000,
      tool_choice: { type: 'tool', name: 'answer' },
      thinking: { type: 'enabled', budget_tokens: 1024 },
    });

    expect(
      toAnthropicRequest(
        { prompt: [{ type: 'user', text: 'hello' }], thinking: false },
        { model: 'claude-test', thinking: { type: 'enabled', budget_tokens: 2048 } },
      ).thinking,
    ).toEqual({ type: 'disabled' });

    const message = {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      stop_reason: 'tool_use',
      stop_sequence: null,
      content: [
        { type: 'text', text: 'done', citations: null },
        { type: 'tool_use', id: 'call-1', name: 'answer', input: { value: 42 } },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    } as Anthropic.Message;

    expect(fromAnthropicMessage(message)).toMatchObject({
      model: 'claude-test',
      finishReason: 'tool_use',
      parts: [
        { type: 'text', text: 'done' },
        { type: 'toolCall', toolCall: { id: 'call-1', name: 'answer', arguments: { value: 42 } } },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 20, cachedInputTokens: 3 },
    });
  });

  it('adds the web_search tool alongside function tools, and extracts citations', () => {
    const request = toAnthropicRequest(
      {
        prompt: [{ type: 'user', text: 'hello' }],
        tools: [{ name: 'answer', description: 'Answer', parameters: { type: 'object' } }],
        search: true,
      },
      { model: 'claude-test' },
    );
    expect(request.tools).toMatchObject([
      { name: 'answer' },
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);

    const message = {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [
        { type: 'server_tool_use', id: 'search-1', name: 'web_search', input: { query: 'Brawl Stars' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'search-1',
          content: [
            {
              type: 'web_search_result',
              url: 'https://example.com/brawl-stars',
              title: 'Brawl Stars',
              encrypted_content: '',
              page_age: null,
            },
          ],
        },
        { type: 'text', text: 'Brawl Stars is a MOBA.', citations: null },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as unknown as Anthropic.Message;

    expect(fromAnthropicMessage(message).citations).toEqual([
      { url: 'https://example.com/brawl-stars', title: 'Brawl Stars' },
    ]);
  });
});
