export enum ModelType {
  /** Default model, typically the most capable but also most expensive */
  DEFAULT = 'default',
  /** Cheaper, faster model with potentially lower quality results */
  CHEAP = 'cheap',
  /** Lite, even cheaper model for simple tasks like summarization */
  LITE = 'lite',
  /** Specialized model for reasoning tasks */
  REASONING = 'reasoning',
}

export interface TokenUsage {
  inputTokens: number | undefined | null;
  outputTokens: number | undefined | null;
  totalTokens: number | undefined | null;
  cacheCreateTokens?: number | null;
  cacheReadTokens?: number | null;
  thinkingTokens?: number | null;
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
  uri?: string; // if specified, takes precedence over base64url
};

export interface PromptItem {
  itemId?: 'INITIAL_PROMPT';
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
  executableCode?: {
    language: string;
    code: string;
  };
  codeExecutionResult?: {
    outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
    output: string;
    outputFiles?: Array<{
      fileId: string;
      filename: string;
      size: number;
      mimeType?: string;
    }>;
  };
} /** Hook function type for generateContent hooks */

export type GenerateContentResultPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'functionCall';
      functionCall: FunctionCall;
    }
  | {
      type: 'media';
      media: {
        mediaType: PromptImageMediaType;
        base64url: string;
      };
    }
  | {
      type: 'webSearch';
      text: string;
      urls: string[];
    }
  | {
      type: 'executableCode';
      code: string;
      language: string;
    }
  | {
      type: 'codeExecutionResult';
      outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
      output: string;
      outputFiles?: Array<{
        fileId: string;
        filename: string;
        size: number;
        mimeType?: string;
      }>;
    };

export type GenerateContentResult = GenerateContentResultPart[];

export type GenerateContentHook = (args: GenerateContentArgs, result: GenerateContentResult) => Promise<void>;

export type GenerateContentArgs = [
  prompt: PromptItem[],
  config: {
    modelType?: ModelType;
    temperature?: number;
    functionDefs?: FunctionDef[];
    requiredFunctionName?: string | null;
    expectedResponseType?: {
      text?: boolean;
      functionCall?: boolean;
      media?: boolean;
      webSearch?: boolean;
      codeExecution?: boolean;
    };
    /** File IDs uploaded to the provider for code execution access */
    fileIds?: string[];
    /** Metadata about uploaded files */
    uploadedFiles?: Array<{
      fileId: string;
      filename: string;
      originalPath: string;
    }>;
  },
  options: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  },
];

export type GenerateContentFunction = (...args: GenerateContentArgs) => Promise<GenerateContentResult>;

export type GenerateImageFunction = (
  prompt: string,
  contextImagePath: string | undefined,
  size: { width: number; height: number },
  modelType: ModelType.DEFAULT | ModelType.CHEAP,
) => Promise<string>;
