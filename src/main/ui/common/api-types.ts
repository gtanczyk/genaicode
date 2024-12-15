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
 * Full service configuration interface.
 * This interface includes sensitive data and should only be used internally.
 */
export interface ServiceConfig {
  /**
   * API key for the service.
   * When retrieved from server, this will be masked.
   */
  apiKey?: string;

  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
  };

  /**
   * Project ID for Vertex AI services.
   */
  googleCloudProjectId?: string;

  /**
   * Google Cloud region for Vertex AI services.
   */
  googleCloudRegion?: string;
}

/**
 * Sanitized version of ServiceConfig that excludes sensitive data.
 * This interface is safe to expose through the API.
 */
export interface SanitizedServiceConfig {
  /**
   * Indicates whether an API key is configured for this service
   */
  hasApiKey: boolean;

  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
  };

  /**
   * Project ID for Vertex AI services.
   */
  googleCloudProjectId?: string;

  /**
   * Google Cloud region for Vertex AI services.
   */
  googleCloudRegion?: string;
}

/**
 * Map of service configurations by service type.
 * This type includes sensitive data and should only be used internally.
 */
export type ServiceConfigurations = Record<AiServiceType, ServiceConfig>;

/**
 * Map of sanitized service configurations by service type.
 * This type is safe to expose through the API.
 */
export type SanitizedServiceConfigurations = Record<AiServiceType, SanitizedServiceConfig>;

/**
 * Type for updating service configuration.
 * Includes service type and new configuration.
 */
export interface ServiceConfigUpdate {
  serviceType: AiServiceType;
  config: ServiceConfig;
}
