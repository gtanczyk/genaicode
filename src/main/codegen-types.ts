import { FunctionDef, GenerateContentFunction } from '../ai-service/common';

export type PluginAiServiceType = `plugin:${string}`;

export type AiServiceType =
  | 'vertex-ai'
  | 'ai-studio'
  | 'vertex-ai-claude'
  | 'chat-gpt'
  | 'anthropic'
  | PluginAiServiceType;

export type ImagenType = 'vertex-ai' | 'dall-e';

export interface UploadedImage {
  base64url: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  originalName: string;
}

export interface CodegenOptions {
  explicitPrompt?: string;
  taskFile?: string;
  considerAllFiles?: boolean;
  allowFileCreate?: boolean;
  allowFileDelete?: boolean;
  allowDirectoryCreate?: boolean;
  allowFileMove?: boolean;
  vision?: boolean;
  imagen?: ImagenType;
  aiService: AiServiceType;

  disableContextOptimization?: boolean;
  temperature?: number;
  cheap?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  requireExplanations?: boolean;
  geminiBlockNone?: boolean;
  disableInitialLint?: boolean;
  contentMask?: string;
  ignorePatterns?: string[];
  askQuestion?: boolean;
  interactive?: boolean;
  ui?: boolean;
  uiPort?: number;
  uiFrameAncestors?: string[];
  disableCache?: boolean;
  dependencyTree?: boolean;
  historyEnabled?: boolean;

  disableAiServiceFallback?: boolean;
  selfReflectionEnabled?: boolean;
  conversationSummaryEnabled?: boolean;
  images?: UploadedImage[];
  isDev?: boolean;
}

interface ExecutorArgs {
  [key: string]: unknown;
}

export type OperationExecutor = (args: ExecutorArgs, options: CodegenOptions) => Promise<void>;

export type Operation = {
  executor: OperationExecutor;
  def: FunctionDef;
};

export interface Plugin {
  name: string;
  aiServices?: Record<string, GenerateContentFunction>;
  operations?: Record<string, Operation>;
}
