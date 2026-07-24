export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall<T = Record<string, unknown>> {
  id?: string;
  name: string;
  arguments: T;
}

export interface ToolResult {
  callId?: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface PromptImage {
  mediaType: ImageMediaType;
  data?: string;
  url?: string;
}

/**
 * GenAIcode's provider-neutral prompt representation.
 *
 * `systemPrompt` is retained as a first-class field for compatibility with the
 * original GenAIcode IR. New code may use `text` on system items as well.
 */
export interface PromptItem {
  type: 'systemPrompt' | 'user' | 'assistant';
  text?: string;
  systemPrompt?: string;
  images?: PromptImage[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  cache?: boolean;
}

export const promptItemsSymbol: unique symbol = Symbol.for('genaicode.promptItems');

export interface PromptConvertible {
  [promptItemsSymbol](): PromptItem | readonly PromptItem[];
}

export type PromptInput = string | PromptItem | PromptConvertible | readonly PromptInput[];

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface TextResultPart {
  type: 'text';
  text: string;
}

export interface ToolCallResultPart {
  type: 'toolCall';
  toolCall: ToolCall;
}

export interface ImageResultPart {
  type: 'image';
  image: PromptImage;
}

export type ResultPart = TextResultPart | ToolCallResultPart | ImageResultPart;

export interface GenerationResult {
  parts: ResultPart[];
  model?: string;
  finishReason?: string;
  usage?: TokenUsage;
  raw?: unknown;
}

export interface SchemaAdapter<T = unknown> {
  parse(value: unknown): T;
}

export type JsonResultParser<T = unknown> = ((value: unknown) => T) | SchemaAdapter<T>;

export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

export interface GenerationRequest {
  prompt: PromptItem[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ModelProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export interface GenerationDefaults {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  metadata?: Record<string, unknown>;
}
