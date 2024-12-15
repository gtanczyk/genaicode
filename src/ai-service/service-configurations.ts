import { AiServiceType } from '../main/codegen-types.js';
import { modelOverrides } from '../main/config.js';
import { getRegisteredAiServices } from '../main/plugin-loader.js';
import {
  ServiceConfig,
  ServiceConfigurations,
  SanitizedServiceConfig,
  SanitizedServiceConfigurations,
} from '../main/ui/common/api-types.js';

const configurations: ServiceConfigurations = {
  'ai-studio': {
    apiKey: process.env.API_KEY,
    modelOverrides: {
      default: modelOverrides.aiStudio?.default ?? 'gemini-1.5-pro-002',
      cheap: modelOverrides.aiStudio?.cheap ?? 'gemini-1.5-flash-002',
    },
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    modelOverrides: {
      default: modelOverrides.anthropic?.default ?? 'claude-3-5-sonnet-20241022',
      cheap: modelOverrides.anthropic?.cheap ?? 'claude-3-5-haiku-20241022',
    },
  },
  'chat-gpt': {
    apiKey: process.env.OPENAI_API_KEY,
    modelOverrides: {
      default: modelOverrides.chatGpt?.default ?? 'gpt-4o-2024-11-20',
      cheap: modelOverrides.chatGpt?.cheap ?? 'gpt-4o-mini',
    },
  },
  'vertex-ai': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT,
    modelOverrides: {
      default: modelOverrides.vertexAi?.default ?? 'gemini-1.5-pro-002',
      cheap: modelOverrides.vertexAi?.cheap ?? 'gemini-1.5-flash-002',
    },
  },
  'vertex-ai-claude': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT,
    modelOverrides: {
      default: 'claude-3-5-sonnet-20240620',
      cheap: 'claude-3-haiku-20240307',
    },
  },
};

[...getRegisteredAiServices().entries()].forEach(([serviceType, service]) => {
  configurations[serviceType] = service.serviceConfig;
});

/**
 * Get all service configurations.
 * This method returns the full configurations including sensitive data.
 * For external use, prefer getSanitizedConfigurations().
 * @internal
 */
export function getServiceConfigurations() {
  return configurations;
}

/**
 * Get configuration for a specific service.
 * This method returns the full configuration including sensitive data.
 * For external use, prefer getSanitizedConfiguration().
 * @internal
 */
export function getServiceConfig(serviceType: AiServiceType): ServiceConfig {
  return configurations[serviceType];
}

/**
 * Get sanitized configurations safe for external use.
 * This version excludes sensitive data like API keys.
 */
export function getSanitizedServiceConfigurations(): SanitizedServiceConfigurations {
  return Object.fromEntries(
    Object.entries(configurations).map(([serviceType, config]) => {
      return [serviceType, sanitizeServiceConfig(config)];
    }),
  ) as SanitizedServiceConfigurations;
}

/**
 * Get sanitized configuration for a specific service.
 * This version excludes sensitive data like API keys.
 */
export function getSanitizedServiceConfiguration(serviceType: AiServiceType): SanitizedServiceConfig | undefined {
  const config = configurations[serviceType];
  if (!config) return undefined;

  return sanitizeServiceConfig(config);
}

/**
 * Update configuration for a specific service
 */
export function updateServiceConfig(serviceType: AiServiceType, config: ServiceConfig): void {
  const currentConfig = configurations[serviceType] || {};

  // If apiKey is not provided, keep the existing one
  const apiKey = config.apiKey || currentConfig.apiKey;

  configurations[serviceType] = {
    ...currentConfig,
    ...config,
    apiKey,
  };
}

/**
 * Helper method to sanitize a service configuration by removing sensitive data
 */
function sanitizeServiceConfig(config: ServiceConfig): SanitizedServiceConfig {
  return {
    hasApiKey: !!config.apiKey,
    modelOverrides: config.modelOverrides,
    googleCloudProjectId: config.googleCloudProjectId,
    googleCloudRegion: config.googleCloudRegion,
  };
}
