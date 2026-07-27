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

/**
 * Portable response-shape hint. Providers map what they support; unsupported
 * variants are ignored rather than rejected.
 */
export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json' }
  | { type: 'json_schema'; name: string; schema: JsonSchema; strict?: boolean };

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Portable thinking / reasoning controls.
 *
 * - `false` disables thinking when the provider allows it.
 * - `budgetTokens: 0` is treated as disabled on providers that use a token budget.
 * - Prefer either `level` or `budgetTokens` — some providers reject both at once.
 */
export type ThinkingConfig =
  | false
  | {
      budgetTokens?: number;
      level?: ThinkingLevel;
    };

export interface GenerationRequest {
  prompt: PromptItem[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  thinking?: ThinkingConfig;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

/**
 * Provider-neutral streaming event IR.
 *
 * Providers may emit deltas as they arrive. Consumers that only need the final
 * answer can ignore intermediate events and wait for `done`.
 */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'image'; image: PromptImage }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; error: unknown }
  | { type: 'done'; result: GenerationResult };

export interface ProviderCapabilities {
  /** Native token streaming via `ModelProvider.stream`. */
  streaming?: boolean;
  /** Function/tool calling. */
  tools?: boolean;
  /** Image input, output, both, or none. */
  images?: false | 'input' | 'output' | 'both';
  /** First-class system prompt / instruction support. */
  systemPrompt?: boolean;
  /** Honors `GenerationRequest.responseFormat` (`json` / `json_schema`). */
  jsonResponse?: boolean;
  /** Honors `GenerationRequest.thinking`. */
  thinking?: boolean;
}

export interface ModelProvider {
  readonly name: string;
  readonly capabilities?: ProviderCapabilities;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  /**
   * Optional native streaming. When omitted, GenAIcode synthesizes a short
   * stream from `generate` (single text snapshot + `done`).
   */
  stream?(request: GenerationRequest): AsyncIterable<StreamEvent>;
}

export interface GenerationDefaults {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  thinking?: ThinkingConfig;
  metadata?: Record<string, unknown>;
}
