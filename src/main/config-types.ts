export interface ImportantContext {
  systemPrompt?: string[];
  files?: string[];
}

/**
 * Configuration for specific model settings within a service.
 */
export interface ModelSpecificSettings {
  /** System instructions specific to this model */
  systemInstruction?: string[];
  /** Maximum number of tokens to generate in the output specific to this model */
  outputTokenLimit?: number;
  /** Whether the model should use 'thinking' mode if available */
  thinkingEnabled?: boolean;
  /** The token budget for 'thinking' mode */
  thinkingBudget?: number;
  /** Temperature unsupported */
  temperatureUnsupported?: boolean;
}

/**
 * Model configuration for each supported AI service
 * Each service can have different model types:
 * - default: Standard model, typically most capable but expensive
 * - cheap: Cost-effective model with potentially lower quality
 * - reasoning: Specialized model for reasoning tasks
 * Specific settings like system instructions or token limits can be defined per model.
 */
export interface ServiceModelConfig {
  /** Model ID for cost-effective operations */
  cheap?: string;
  /** Model ID for lite operations */
  lite?: string;
  /** Model ID for standard operations (default model) */
  default?: string;
  /** Model ID for reasoning-specific tasks */
  reasoning?: string;
  /** Specific settings for individual models within this service */
  modelSpecificSettings?: {
    [modelName: string]: ModelSpecificSettings;
  };
}

export interface ModelOverrides {
  openai?: ServiceModelConfig;
  anthropic?: ServiceModelConfig;
  vertexAi?: ServiceModelConfig;
  aiStudio?: ServiceModelConfig;
  localLlm?: ServiceModelConfig;
  githubModels?: ServiceModelConfig;
}

/**
 * Configuration for the project codegen
 *
 * IMPORTANT: Keep this interface in sync with the JSON schema in config-schema.ts
 */
export interface RcConfig {
  rootDir: string;
  lintCommand?: string;
  extensions?: string[];
  ignorePaths?: string[];
  popularDependencies?: {
    enabled?: boolean;
    threshold?: number;
  };
  importantContext?: ImportantContext;
  modelOverrides?: ModelOverrides;
  plugins?: string[];
  featuresEnabled?: {
    appContext?: boolean;
    gitContext?: boolean;
    containerTask?: boolean;
  };
}
