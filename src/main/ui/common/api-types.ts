import { AiServiceType } from '../../codegen-types.js';
import { UsageMetrics } from '../../common/cost-collector.js';

export type Usage = {
  usageMetrics: Record<AiServiceType | 'total', UsageMetrics>;
};

export interface CodegenResult {
  success: boolean;
  message?: string;
}

export type ConfirmationProps =
  | {
      includeAnswer: boolean;
      confirmLabel: string;
      declineLabel: string;
      defaultValue: boolean;
    }
  | undefined;

export interface Question {
  id: string;
  text: string;
  confirmation: ConfirmationProps;
}

// Service configuration types

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
};

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
  };
} & (T extends keyof ServiceConfigRequirements
  ? ServiceConfigRequirements[T]
  : {
      apiKey?: string;
      googleCloudProjectId?: string;
      googleCloudRegion?: string;
    });

/**
 * Sanitized version of ServiceConfig that excludes sensitive data.
 * This interface is safe to expose through the API.
 */
export type SanitizedServiceConfig = {
  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
  };
} & (
  | {
      /**
       * Indicates whether an API key is configured for this service
       * Only relevant for services that use API keys
       */
      hasApiKey?: boolean;
      googleCloudProjectId?: '';
      googleCloudRegion?: '';
    }
  | {
      hasApiKey: false;
      googleCloudProjectId?: string;
      googleCloudRegion?: string;
    }
);

/**
 * Map of service configurations by service type.
 * This type includes sensitive data and should only be used internally.
 */
export type ServiceConfigurations = {
  [K in AiServiceType]: ServiceConfig<K>;
};

/**
 * Map of sanitized service configurations by service type.
 * This type is safe to expose through the API.
 */
export type SanitizedServiceConfigurations = {
  [K in AiServiceType]: SanitizedServiceConfig;
};

/**
 * Type for updating service configuration.
 * Includes service type and new configuration.
 */
export interface ServiceConfigUpdate<T extends AiServiceType = AiServiceType> {
  serviceType: T;
  config: ServiceConfig<T>;
}
