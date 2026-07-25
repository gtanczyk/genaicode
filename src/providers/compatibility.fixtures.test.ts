import { describe, expect, it } from 'vitest';
import { toAnthropicMessages, toAnthropicRequest, toAnthropicSystem } from './anthropic-converter.js';
import { multimodalToolRoundTripPrompt, sampleTools } from './fixtures/multimodal-tool-roundtrip.js';
import { toGoogleContents, toGoogleRequest, toGoogleSystemInstruction } from './google-converter.js';
import { toOpenAIMessages, toOpenAIRequest } from './openai-converter.js';

describe('compatibility fixtures', () => {
  it('round-trips the shared multimodal tool fixture across converters', () => {
    const openaiMessages = toOpenAIMessages(multimodalToolRoundTripPrompt);
    const anthropicMessages = toAnthropicMessages(multimodalToolRoundTripPrompt);
    const googleContents = toGoogleContents(multimodalToolRoundTripPrompt);

    expect(openaiMessages.some((message) => message.role === 'tool')).toBe(true);
    expect(anthropicMessages[0]?.role).toBe('assistant');
    expect(googleContents[0]?.role).toBe('model');

    expect(toOpenAIRequest({ prompt: multimodalToolRoundTripPrompt, tools: sampleTools }, 'm').tools).toHaveLength(1);
    expect(
      toAnthropicRequest(
        { prompt: multimodalToolRoundTripPrompt, tools: sampleTools },
        { model: 'm' },
      ).tools,
    ).toHaveLength(1);
    expect(toGoogleRequest({ prompt: multimodalToolRoundTripPrompt, tools: sampleTools }, { model: 'm' }).config?.tools)
      .toBeTruthy();

    expect(toAnthropicSystem(multimodalToolRoundTripPrompt)[0]?.text).toContain('captions');
    expect(toGoogleSystemInstruction(multimodalToolRoundTripPrompt)?.parts?.[0]).toMatchObject({
      text: expect.stringContaining('captions'),
    });
  });
});
