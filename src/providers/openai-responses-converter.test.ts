import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../core/types.js';
import { multimodalToolRoundTripPrompt, sampleTools } from './fixtures/multimodal-tool-roundtrip.js';
import {
  fromOpenAIResponse,
  fromOpenAIResponsesStream,
  toOpenAIResponsesInput,
  toOpenAIResponsesRequest,
} from './openai-responses-converter.js';

function response(partial: Partial<OpenAI.Responses.Response>): OpenAI.Responses.Response {
  return { model: 'gpt-6.2-sol', status: 'completed', output: [], ...partial } as OpenAI.Responses.Response;
}

describe('OpenAI Responses converter', () => {
  it('converts multimodal prompts and tool round trips', () => {
    expect(toOpenAIResponsesInput(multimodalToolRoundTripPrompt)).toEqual([
      { role: 'system', content: 'Return captions and call tools when needed.' },
      { role: 'assistant', content: 'checking' },
      { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"id":7}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"ok":true}' },
      { role: 'user', content: 'continue' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'caption' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'auto' },
        ],
      },
    ]);
  });

  it('converts request options', () => {
    expect(
      toOpenAIResponsesRequest(
        {
          prompt: [{ type: 'user', text: 'hello' }],
          tools: sampleTools,
          toolChoice: { name: 'lookup' },
          responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true },
          maxOutputTokens: 100,
          temperature: 0.2,
        },
        'gpt-4.1',
      ),
    ).toMatchObject({
      model: 'gpt-4.1',
      temperature: 0.2,
      max_output_tokens: 100,
      store: false,
      tools: [{ type: 'function', name: 'lookup', strict: false, parameters: sampleTools[0].parameters }],
      tool_choice: { type: 'function', name: 'lookup' },
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true } },
    });
    const json = toOpenAIResponsesRequest(
      { prompt: [{ type: 'user', text: 'hello' }], responseFormat: { type: 'json' }, temperature: 0.2 },
      'gpt-6.2-sol',
    );
    expect(json.text).toEqual({ format: { type: 'json_object' } });
    expect(json.temperature).toBeUndefined();
  });

  it('normalizes responses', () => {
    const result = fromOpenAIResponse(
      response({
        output: [
          { type: 'reasoning', id: 'rs_1', summary: [] },
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'calling', annotations: [] }],
          },
          { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":7}' },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          input_tokens_details: { cached_tokens: 2 },
          output_tokens_details: { reasoning_tokens: 1 },
        },
      }),
    );
    expect(result).toMatchObject({
      model: 'gpt-6.2-sol',
      finishReason: 'tool_calls',
      parts: [
        { type: 'text', text: 'calling' },
        { type: 'toolCall', toolCall: { id: 'call_1', name: 'lookup', arguments: { id: 7 } } },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2 },
    });
    expect(
      fromOpenAIResponse(response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
        .finishReason,
    ).toBe('length');
  });

  it('streams text and tool-call deltas, then the finished response', async () => {
    const final = response({
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":7}' }],
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
    const events = [
      { type: 'response.output_text.delta', delta: 'hi' },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 1, delta: '{"id":' },
      { type: 'response.completed', response: final },
    ] as unknown as OpenAI.Responses.ResponseStreamEvent[];
    async function* source() {
      yield* events;
    }
    const out: StreamEvent[] = [];
    for await (const event of fromOpenAIResponsesStream(source())) out.push(event);
    expect(out.map((event) => event.type)).toEqual(['text-delta', 'tool-call-delta', 'tool-call', 'usage', 'done']);
    expect(out[1]).toEqual({ type: 'tool-call-delta', id: 'call_1', name: 'lookup', argumentsDelta: '{"id":' });
    expect(out[2]).toEqual({ type: 'tool-call', toolCall: { id: 'call_1', name: 'lookup', arguments: { id: 7 } } });
  });

  it('throws on a failed response', async () => {
    async function* source() {
      yield {
        type: 'response.failed',
        response: response({ status: 'failed', error: { code: 'server_error', message: 'boom' } }),
      } as unknown as OpenAI.Responses.ResponseStreamEvent;
    }
    await expect(async () => {
      for await (const event of fromOpenAIResponsesStream(source())) void event;
    }).rejects.toThrow('boom');
  });
});
