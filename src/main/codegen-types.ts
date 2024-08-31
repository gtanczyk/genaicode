export type AiServiceType = 'vertex-ai' | 'ai-studio' | 'vertex-ai-claude' | 'chat-gpt' | 'anthropic';

export type ImagenType = 'vertex-ai' | 'dall-e';

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

  // Added cli parameters that affect code generation
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
  disableCache?: boolean;
}
