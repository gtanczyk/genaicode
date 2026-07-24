import type { GenerationResult, PromptItem, ToolCall } from './types.js';

export function resultText(result: GenerationResult): string {
  return result.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function resultToolCalls(result: GenerationResult): ToolCall[] {
  return result.parts.filter((part) => part.type === 'toolCall').map((part) => part.toolCall);
}

export function resultToPromptItem(result: GenerationResult): PromptItem {
  return {
    type: 'assistant',
    text: resultText(result) || undefined,
    toolCalls: resultToolCalls(result),
    images: result.parts.filter((part) => part.type === 'image').map((part) => part.image),
  };
}

export function parseJsonResult<T = unknown>(
  result: GenerationResult,
  parse: (value: unknown) => T = (value) => value as T,
): T {
  const text = resultText(result).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return parse(JSON.parse(fenced?.[1] ?? text) as unknown);
}
