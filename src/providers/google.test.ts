import { describe, expect, it, vi } from 'vitest';

const chunks: unknown[] = [];
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GoogleGenAI: class {
    models = {
      generateContentStream: async () =>
        (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
    };
  },
}));

const { gemini } = await import('./google.js');

describe('gemini stream', () => {
  it('keeps a signed tool call from an earlier chunk', async () => {
    chunks.splice(
      0,
      chunks.length,
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'set_theme', args: { theme: 'dark' } }, thoughtSignature: 'sig-1' }],
            },
          },
        ],
      },
      {
        candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      },
    );
    const provider = gemini({ apiKey: 'test', model: 'gemini-test' });
    const events = [];
    for await (const event of provider.stream!({ prompt: [{ type: 'user', text: 'go dark' }] } as never)) {
      events.push(event);
    }
    const call = { name: 'set_theme', arguments: { theme: 'dark' }, signature: 'sig-1' };
    expect(events).toContainEqual({ type: 'tool-call', toolCall: expect.objectContaining(call) });
    const done = events.at(-1) as { type: 'done'; result: { parts: unknown[]; finishReason?: string } };
    expect(done.result.parts).toEqual([{ type: 'toolCall', toolCall: expect.objectContaining(call) }]);
    expect(done.result.finishReason).toBe('STOP');
  });
});
