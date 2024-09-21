export type AiServiceType = 'vertex-ai' | 'ai-studio' | 'vertex-ai-claude' | 'chat-gpt' | 'anthropic';

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
  disableCache?: boolean;
  dependencyTree?: boolean;

  // New property for disabling AI service fallback
  disableAiServiceFallback?: boolean;

  // New property for handling multimodal inputs
  images?: UploadedImage[];

  // GenAIcode is in dev mode
  isDev?: boolean;
}

export interface MultimodalPrompt {
  text: string;
  images: UploadedImage[];
}
