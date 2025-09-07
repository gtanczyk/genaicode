import { ModelSpecificSettings } from '../main/config-types.js';

/**
 * Full service configuration interface.
 * This interface includes sensitive data and should only be used internally.
 */

export type ServiceConfig<T extends AiServiceType = AiServiceType> = {
  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes and settings per model.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
    lite?: string; // Model name for lite mode
    reasoning?: string; // Model name for reasoning mode
    /** Specific settings for individual models within this service */
    modelSpecificSettings?: {
      [modelName: string]: ModelSpecificSettings;
    };
  };
} & (T extends keyof ServiceConfigRequirements
  ? ServiceConfigRequirements[T]
  : {
      // Default structure for services not in ServiceConfigRequirements (e.g., plugins)
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
    googleCloudRegion?: string;
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
  'github-models': {
    apiKey: string | undefined;
    googleCloudProjectId?: never;
    googleCloudRegion?: never;
  };
}; /** Example: {@link ../../examples/genaicode_plugins/grok_ai_service.ts} */

export type PluginAiServiceType =
  `plugin:${string}`; /** Example: {@link ../../examples/genaicode_plugins/nonsense_action_handlers.ts} */

export type PluginActionType = `plugin:${string}`;

export type AiServiceType =
  | 'vertex-ai'
  | 'ai-studio'
  | 'openai'
  | 'local-llm'
  | 'anthropic'
  | 'github-models'
  | PluginAiServiceType;
