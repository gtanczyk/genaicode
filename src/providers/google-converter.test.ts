import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
  fromGoogleResponse,
  toGoogleContents,
  toGoogleRequest,
  toGoogleSystemInstruction,
} from './google-converter.js';

describe('Google converter', () => {
  it('converts system instructions, images, and tool round trips', () => {
    const prompt = [
      { type: 'systemPrompt' as const, systemPrompt: 'rules' },
      {
        type: 'assistant' as const,
        text: 'checking',
        toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { id: 7 } }],
      },
      {
        type: 'user' as const,
        text: 'continue',
        toolResults: [{ callId: 'call-1', name: 'lookup', content: '{"ok":true}' }],
        images: [{ mediaType: 'image/png' as const, url: 'gs://bucket/image.png' }],
      },
    ];

    expect(toGoogleSystemInstruction(prompt)).toEqual({ parts: [{ text: 'rules' }] });
    expect(toGoogleContents(prompt)).toEqual([
      {
        role: 'model',
        parts: [{ text: 'checking' }, { functionCall: { id: 'call-1', name: 'lookup', args: { id: 7 } } }],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call-1',
              name: 'lookup',
              response: { ok: true },
            },
          },
          { fileData: { fileUri: 'gs://bucket/image.png', mimeType: 'image/png' } },
          { text: 'continue' },
        ],
      },
    ]);
  });

  it('maps request policy and normalizes responses', () => {
    const request = toGoogleRequest(
      {
        prompt: [{ type: 'user', text: 'hello' }],
        tools: [{ name: 'answer', description: 'Answer', parameters: { type: 'object' } }],
        toolChoice: { name: 'answer' },
        responseFormat: { type: 'json' },
        thinking: { level: 'minimal' },
      },
      { model: 'gemini-test' },
    );
    expect(request).toMatchObject({
      model: 'gemini-test',
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
        toolConfig: {
          functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['answer'] },
        },
      },
    });

    expect(
      toGoogleRequest(
        { prompt: [{ type: 'user', text: 'hello' }], thinking: false },
        { model: 'gemini-test' },
      ).config,
    ).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } });

    const response = {
      modelVersion: 'gemini-test',
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: [
              { text: 'done' },
              { functionCall: { id: 'call-1', name: 'answer', args: { value: 42 } } },
              { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
        cachedContentTokenCount: 3,
      },
    } as GenerateContentResponse;

    expect(fromGoogleResponse(response)).toMatchObject({
      model: 'gemini-test',
      finishReason: 'STOP',
      parts: [
        { type: 'text', text: 'done' },
        { type: 'toolCall', toolCall: { id: 'call-1', name: 'answer', arguments: { value: 42 } } },
        { type: 'image', image: { mediaType: 'image/png', data: 'aGVsbG8=' } },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 3 },
    });
  });

  it('uses tool names when optional Google call ids are missing', () => {
    expect(
      toGoogleContents([
        {
          type: 'assistant',
          toolCalls: [{ name: 'lookup', arguments: { id: 7 } }],
        },
        {
          type: 'user',
          toolResults: [{ name: 'lookup', content: '{"ok":true}' }],
        },
      ]),
    ).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { id: 'lookup', name: 'lookup', args: { id: 7 } } }],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'lookup',
              name: 'lookup',
              response: { ok: true },
            },
          },
        ],
      },
    ]);
  });
});
