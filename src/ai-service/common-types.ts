export enum ModelType {
  /** Default model, typically the most capable but also most expensive */
  DEFAULT = 'default',
  /** Cheaper, faster model with potentially lower quality results */
  CHEAP = 'cheap',
  /** Specialized model for reasoning tasks */
  REASONING = 'reasoning',
}

export interface TokenUsage {
  inputTokens: number | undefined | null;
  outputTokens: number | undefined | null;
  totalTokens: number | undefined | null;
  cacheCreateTokens?: number | null;
  cacheReadTokens?: number | null;
}

export interface FunctionDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface FunctionCall<T = Record<string, unknown>> {
  id?: string;
  name: string;
  args?: T;
}

export type PromptImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type PromptItemImage = {
  mediaType: PromptImageMediaType;
  base64url: string;
};

export interface PromptItem {
  type: 'systemPrompt' | 'user' | 'assistant';
  systemPrompt?: string;
  text?: string;
  functionResponses?: {
    call_id?: string;
    name: string;
    content?: string;
    isError?: boolean;
  }[];
  images?: PromptItemImage[];
  functionCalls?: FunctionCall[];
  cache?: boolean;
} /** Hook function type for generateContent hooks */

export type GenerateContentHook = (args: GenerateContentArgs, result: FunctionCall[]) => Promise<void>;

export type GenerateContentArgs = [
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType?: ModelType,
  options?: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  },
];

export type GenerateContentFunction = (...args: GenerateContentArgs) => Promise<FunctionCall[]>;

export type GenerateImageFunction = (
  prompt: string,
  contextImagePath: string | undefined,
  size: { width: number; height: number },
  modelType: ModelType.DEFAULT | ModelType.CHEAP,
) => Promise<string>;
