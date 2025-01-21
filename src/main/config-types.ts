export interface ImportantContext {
  systemPrompt?: string[];
  files?: string[];
}

/**
 * Model configuration for each supported AI service
 * Each service can have different model types:
 * - default: Standard model, typically most capable but expensive
 * - cheap: Cost-effective model with potentially lower quality
 * - reasoning: Specialized model for reasoning tasks
 */
export interface ServiceModelConfig {
  /** Model ID for cost-effective operations */
  cheap?: string;
  /** Model ID for standard operations (default model) */
  default?: string;
  /** Model ID for reasoning-specific tasks */
  reasoning?: string;
}

export interface ModelOverrides {
  openai?: ServiceModelConfig;
  anthropic?: ServiceModelConfig;
  vertexAi?: ServiceModelConfig;
  aiStudio?: ServiceModelConfig;
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
  importantContext?: ImportantContext;
  modelOverrides?: ModelOverrides;
  plugins?: string[];
  featuresEnabled?: {
    appContext?: boolean;
  };
}
