import { FunctionCall, FunctionDef, GenerateContentArgs, GenerateContentFunction } from '../ai-service/common';
import { ActionHandler } from '../prompt/steps/step-ask-question/step-ask-question-types';

/** Example: {@link ../../examples/genaicode_plugins/grok_ai_service.ts} */
export type PluginAiServiceType = `plugin:${string}`;

/** Example: {@link ../../examples/genaicode_plugins/nonsense_action_handlers.ts} */
export type PluginActionType = `plugin:${string}`;

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
  contentMask?: string;
  ignorePatterns?: string[];
  askQuestion: boolean;
  interactive?: boolean;
  ui?: boolean;
  uiPort?: number;
  uiFrameAncestors?: string[];
  disableCache?: boolean;
  historyEnabled?: boolean;

  disableAiServiceFallback?: boolean;
  conversationSummaryEnabled?: boolean;
  images?: UploadedImage[];
  isDev?: boolean;
}

/** Hook function type for generateContent hooks */
export type GenerateContentHook = (args: GenerateContentArgs, result: FunctionCall[]) => Promise<void>;

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
  /**
   * Hook that will be executed for each generateContent function call.
   */
  generateContentHook?: GenerateContentHook;
  operations?: Record<string, Operation>;
  actionHandlers?: Record<
    string,
    {
      /** The action handler implementation */
      handler: ActionHandler;
      /**
       * Description of what this action handler does.
       * This description will be included in the askQuestion function definition
       * to help the AI understand when to use this action.
       */
      description: string;
    }
  >;
}
