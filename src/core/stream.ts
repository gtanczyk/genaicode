import { resultText, resultToolCalls } from './result.js';
import type { GenerationResult, ModelProvider, StreamEvent, ToolCall } from './types.js';

/**
 * Turn a completed generation into a short synthetic stream.
 * Used when a provider (or plugin chain) has no native `stream` implementation.
 */
export async function* generateAsStream(
  generate: (request: Parameters<ModelProvider['generate']>[0]) => Promise<GenerationResult>,
  request: Parameters<ModelProvider['generate']>[0],
): AsyncGenerator<StreamEvent> {
  try {
    const result = await generate(request);
    const text = resultText(result);
    if (text) {
      yield { type: 'text-delta', text };
    }
    for (const toolCall of resultToolCalls(result)) {
      yield { type: 'tool-call', toolCall };
    }
    for (const part of result.parts) {
      if (part.type === 'image') {
        yield { type: 'image', image: part.image };
      }
    }
    if (result.usage) {
      yield { type: 'usage', usage: result.usage };
    }
    yield { type: 'done', result };
  } catch (error) {
    yield { type: 'error', error };
    throw error;
  }
}

export function providerStream(
  provider: ModelProvider,
  request: Parameters<ModelProvider['generate']>[0],
): AsyncIterable<StreamEvent> {
  if (provider.stream) {
    return provider.stream(request);
  }
  return generateAsStream((nextRequest) => provider.generate(nextRequest), request);
}

/** Collect a stream into the final `GenerationResult` (from `done` or by accumulation). */
export async function collectStream(events: AsyncIterable<StreamEvent>): Promise<GenerationResult> {
  let text = '';
  const toolCalls: ToolCall[] = [];
  const images: GenerationResult['parts'] = [];
  let usage: GenerationResult['usage'];
  let model: string | undefined;
  let finishReason: string | undefined;
  let raw: unknown;
  let doneResult: GenerationResult | undefined;

  for await (const event of events) {
    switch (event.type) {
      case 'text-delta':
        text += event.text;
        break;
      case 'tool-call':
        toolCalls.push(event.toolCall);
        break;
      case 'image':
        images.push({ type: 'image', image: event.image });
        break;
      case 'usage':
        usage = event.usage;
        break;
      case 'done':
        doneResult = event.result;
        break;
      case 'error':
        throw event.error instanceof Error ? event.error : new Error(String(event.error));
      case 'tool-call-delta':
        break;
    }
  }

  if (doneResult) {
    return doneResult;
  }

  const parts: GenerationResult['parts'] = [];
  if (text) parts.push({ type: 'text', text });
  for (const toolCall of toolCalls) {
    parts.push({ type: 'toolCall', toolCall });
  }
  parts.push(...images);

  return { parts, model, finishReason, usage, raw };
}

/** Yield only text deltas from a stream. */
export async function* streamTextDeltas(events: AsyncIterable<StreamEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    if (event.type === 'text-delta' && event.text) {
      yield event.text;
    } else if (event.type === 'error') {
      throw event.error instanceof Error ? event.error : new Error(String(event.error));
    }
  }
}
