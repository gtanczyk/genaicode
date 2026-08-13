import { ThinkingLevel, type GenerateContentResponse } from '@google/genai';
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
        { prompt: [{ type: 'user', text: 'hello' }], responseFormat: { type: 'json' } },
        { model: 'gemini-test' },
      ).config,
    ).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    });

    // Provider defaults.config.thinkingConfig is preserved when request has no explicit thinking
    expect(
      toGoogleRequest(
        { prompt: [{ type: 'user', text: 'hello' }], responseFormat: { type: 'json' } },
        { model: 'gemini-test', config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } },
      ).config,
    ).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    });

    // Request-level thinking overrides provider defaults.config.thinkingConfig
    expect(
      toGoogleRequest(
        { prompt: [{ type: 'user', text: 'hello' }], thinking: { level: 'high' } },
        { model: 'gemini-test', config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } },
      ).config,
    ).toMatchObject({
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    });

    expect(
      toGoogleRequest(
        { prompt: [{ type: 'user', text: 'hello' }], thinking: false },
        { model: 'gemini-test', config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } },
      ).config,
    ).toMatchObject({ thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } });

    expect(
      toGoogleRequest({ prompt: [{ type: 'user', text: 'hello' }], thinking: false }, { model: 'gemini-test' }).config,
    ).toMatchObject({ thinkingConfig: { thinkingLevel: 'MINIMAL' } });

    expect(
      toGoogleRequest(
        { prompt: [{ type: 'user', text: 'hello' }], thinking: { budgetTokens: 128 } },
        { model: 'gemini-test' },
      ).config,
    ).toMatchObject({ thinkingConfig: { thinkingBudget: 128 } });

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

  it('maps `search` to the googleSearch built-in tool, and lets function tools win when both are set', () => {
    const withSearch = toGoogleRequest(
      { prompt: [{ type: 'user', text: 'hello' }], search: true },
      { model: 'gemini-test' },
    );
    expect(withSearch.config).toMatchObject({ tools: [{ googleSearch: {} }] });

    // The API rejects functionDeclarations alongside a built-in tool like googleSearch
    // in the same call, so function tools take priority when a request sets both.
    const withBoth = toGoogleRequest(
      {
        prompt: [{ type: 'user', text: 'hello' }],
        tools: [{ name: 'answer', description: 'Answer', parameters: { type: 'object' } }],
        search: true,
      },
      { model: 'gemini-test' },
    );
    expect(withBoth.config).toMatchObject({
      tools: [
        { functionDeclarations: [{ name: 'answer', description: 'Answer', parametersJsonSchema: { type: 'object' } }] },
      ],
    });
  });

  it('extracts citations from grounding metadata', () => {
    const response = {
      modelVersion: 'gemini-test',
      candidates: [
        {
          finishReason: 'STOP',
          content: { role: 'model', parts: [{ text: 'Brawl Stars is a MOBA.' }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com/brawl-stars', title: 'Brawl Stars' } },
              { web: {} }, // no uri: dropped, not surfaced as a broken citation
            ],
          },
        },
      ],
    } as GenerateContentResponse;

    expect(fromGoogleResponse(response).citations).toEqual([
      { url: 'https://example.com/brawl-stars', title: 'Brawl Stars' },
    ]);
    expect(
      fromGoogleResponse({ modelVersion: 'gemini-test', candidates: [] } as unknown as GenerateContentResponse)
        .citations,
    ).toBeUndefined();
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
