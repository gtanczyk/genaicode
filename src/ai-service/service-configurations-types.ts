/**
 * Full service configuration interface.
 * This interface includes sensitive data and should only be used internally.
 */

export type ServiceConfig<T extends AiServiceType = AiServiceType> = {
  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
    reasoning?: string; // Model name for reasoning mode
    systemInstruction?: string[]; // System instructions for the model
    outputTokenLimit?: number; // Maximum number of output tokens
  };
} & (T extends keyof ServiceConfigRequirements
  ? ServiceConfigRequirements[T]
  : {
      apiKey?: string;
      openaiBaseUrl?: string;
      googleCloudProjectId?: string;
      googleCloudRegion?: string;
    }); // Service configuration types
/**
 * Type map defining which configuration fields are required for each service type
 */

export type ServiceConfigRequirements = {
  'vertex-ai': {
    apiKey?: never;
    googleCloudProjectId: string;
    googleCloudRegion?: never;
  };
  'vertex-ai-claude': {
    apiKey?: never;
    googleCloudProjectId: string;
    googleCloudRegion: string;
  };
  openai: {
    apiKey: string | undefined;
    openaiBaseUrl?: string | undefined;
    googleCloudProjectId?: never;
    googleCloudRegion?: never;
  };
  'local-llm': {
    apiKey?: string | undefined;
    openaiBaseUrl?: string | undefined;
    googleCloudProjectId?: never;
    googleCloudRegion?: never;
  };
  'ai-studio': {
    apiKey: string | undefined;
    googleCloudProjectId?: never;
    googleCloudRegion?: never;
  };
  anthropic: {
    apiKey: string | undefined;
    googleCloudProjectId?: never;
    googleCloudRegion?: never;
  };
}; /** Example: {@link ../../examples/genaicode_plugins/grok_ai_service.ts} */

export type PluginAiServiceType = `plugin:${string}`;
/** Example: {@link ../../examples/genaicode_plugins/nonsense_action_handlers.ts} */

export type PluginActionType = `plugin:${string}`;

export type AiServiceType =
  | 'vertex-ai'
  | 'ai-studio'
  | 'vertex-ai-claude'
  | 'openai'
  | 'local-llm'
  | 'anthropic'
  | PluginAiServiceType;
