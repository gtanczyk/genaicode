import { promptItemsSymbol } from './types.js';
import type { PromptConvertible, PromptImage, PromptInput, PromptItem, ToolCall, ToolResult } from './types.js';

function isPromptItem(value: object): value is PromptItem {
  return 'type' in value && ['systemPrompt', 'user', 'assistant'].includes(String(value.type));
}

function isPromptConvertible(value: object): value is PromptConvertible {
  return promptItemsSymbol in value && typeof value[promptItemsSymbol] === 'function';
}

export function toPromptItems(input: PromptInput): PromptItem[] {
  if (typeof input === 'string') {
    return [user(input)];
  }
  if (Array.isArray(input)) {
    return input.flatMap(toPromptItems);
  }
  if (isPromptConvertible(input)) {
    const converted = input[promptItemsSymbol]();
    return Array.isArray(converted) ? [...converted] : [converted];
  }
  if (isPromptItem(input)) {
    return [{ ...input }];
  }
  throw new TypeError('Value cannot be converted to PromptItem.');
}

export function prompt(...inputs: PromptInput[]): PromptItem[] {
  return inputs.flatMap(toPromptItems);
}

export function system(text: string): PromptItem {
  return { type: 'systemPrompt', systemPrompt: text };
}

export function user(text: string, options: { images?: PromptImage[]; toolResults?: ToolResult[] } = {}): PromptItem {
  return { type: 'user', text, ...options };
}

export function assistant(text: string, options: { toolCalls?: ToolCall[] } = {}): PromptItem {
  return { type: 'assistant', text, ...options };
}

export function toolResults(...results: ToolResult[]): PromptItem {
  return { type: 'user', toolResults: results };
}

export function image(dataOrUrl: string, mediaType: PromptImage['mediaType']): PromptImage {
  return dataOrUrl.startsWith('http://') || dataOrUrl.startsWith('https://')
    ? { mediaType, url: dataOrUrl }
    : { mediaType, data: dataOrUrl };
}

export function asPrompt(convert: () => PromptItem | readonly PromptItem[]): PromptConvertible {
  return { [promptItemsSymbol]: convert };
}
