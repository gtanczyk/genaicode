import { FunctionCall, FunctionDef, GenerateContentArgs, GenerateContentFunction } from '../ai-service/common';
import { ActionHandler } from '../prompt/steps/step-ask-question/step-ask-question-types';
import { ServiceConfig } from './ui/common/api-types';

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

/** Arguments of the codegen planning function call */
export type CodegenPlanningArgs = {
  problemAnalysis: string;
  codeChanges: string;
  affectedFiles: {
    reason: string;
    filePath: string;
    dependencies: string[];
  }[];
};

/**
 * Arguments passed to the planning hooks
 */
export interface PlanningHookArgs {
  /** The original planning prompt */
  prompt: string;
  /** The options passed to the codegen */
  options: CodegenOptions;
  /** The result of the planning step, if in post-processing phase */
  result?: FunctionCall<CodegenPlanningArgs>;
}

/**
 * Hook function type for modifying the planning prompt before execution
 * Return modified prompt or undefined to use original prompt
 */
export type PlanningPreHook = (args: PlanningHookArgs) => Promise<string | void>;

/**
 * Hook function type for post-processing the planning result
 * Return modified result or undefined to use original result
 */
export type PlanningPostHook = (args: PlanningHookArgs) => Promise<FunctionCall<CodegenPlanningArgs> | void>;

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
  aiServices?: Record<
    string,
    {
      generateContent: GenerateContentFunction;
      serviceConfig: ServiceConfig;
    }
  >;
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
  /**
   * Hook that will be executed before the planning prompt is sent to the model.
   * Can be used to modify the prompt.
   * Return modified prompt or undefined to use original prompt.
   */
  planningPreHook?: PlanningPreHook;
  /**
   * Hook that will be executed after the planning result is received from the model.
   * Can be used to modify the result.
   * Return modified result or undefined to use original result.
   */
  planningPostHook?: PlanningPostHook;
}
