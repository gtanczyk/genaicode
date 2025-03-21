import { AiServiceType } from './service-configurations-types.js';
import { modelOverrides } from '../main/config.js';
import { getRegisteredAiServices } from '../main/plugin-loader.js';
import {
  ServiceConfigurations,
  SanitizedServiceConfig,
  SanitizedServiceConfigurations,
} from '../main/ui/common/api-types.js';
import { ServiceConfigRequirements } from './service-configurations-types.js';
import { ServiceConfig } from './service-configurations-types.js';

const configurations: ServiceConfigurations = {
  'ai-studio': {
    apiKey: process.env.API_KEY,
    modelOverrides: {
      default: modelOverrides.aiStudio?.default ?? 'gemini-1.5-pro-002',
      cheap: modelOverrides.aiStudio?.cheap ?? 'gemini-2.0-flash',
      reasoning: modelOverrides.aiStudio?.reasoning ?? 'gemini-2.0-flash-thinking-exp-01-21',
    },
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    modelOverrides: {
      default: modelOverrides.anthropic?.default ?? 'claude-3-7-sonnet-20250219',
      cheap: modelOverrides.anthropic?.cheap ?? 'claude-3-5-haiku-20241022',
      reasoning: modelOverrides.anthropic?.reasoning ?? 'claude-3-7-sonnet-20250219',
    },
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    modelOverrides: {
      default: modelOverrides.openai?.default ?? 'gpt-4o',
      cheap: modelOverrides.openai?.cheap ?? 'gpt-4o-mini',
      reasoning: modelOverrides.openai?.reasoning ?? 'o3-mini',
    },
  },
  'local-llm': {
    apiKey: process.env.LOCAL_LLM_API_KEY ?? 'local-llm',
    openaiBaseUrl: process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:11434/v1/',
    modelOverrides: {
      default: modelOverrides.localLlm?.default ?? 'gemma3:12b',
      cheap: modelOverrides.localLlm?.cheap ?? 'gemma3:12b',
      reasoning: modelOverrides.localLlm?.reasoning ?? 'gemma3:12b',
    },
  },
  'vertex-ai': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    modelOverrides: {
      default: modelOverrides.vertexAi?.default ?? 'gemini-1.5-pro-002',
      cheap: modelOverrides.vertexAi?.cheap ?? 'gemini-2.0-flash',
      reasoning: modelOverrides.vertexAi?.reasoning ?? 'gemini-2.0-flash-thinking-exp-01-21',
    },
  },
  'vertex-ai-claude': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    googleCloudRegion: process.env.GOOGLE_CLOUD_REGION ?? '',
    modelOverrides: {
      default: 'claude-3-5-sonnet@20240620',
      cheap: 'claude-3-haiku@20240307',
      reasoning: 'claude-3-5-sonnet@20240620',
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
export function getServiceConfig<T extends AiServiceType>(serviceType: T): ServiceConfig<T> {
  return configurations[serviceType] as ServiceConfig<T>;
}

/**
 * Get sanitized configurations safe for external use.
 * This version excludes sensitive data like API keys.
 */
export function getSanitizedServiceConfigurations(): SanitizedServiceConfigurations {
  return Object.fromEntries(
    Object.entries(configurations).map(([serviceType, config]) => {
      return [serviceType, sanitizeServiceConfig(serviceType as AiServiceType, config)];
    }),
  ) as SanitizedServiceConfigurations;
}

/**
 * Get sanitized configuration for a specific service.
 * This version excludes sensitive data like API keys.
 */
export function getSanitizedServiceConfiguration<T extends AiServiceType>(
  serviceType: T,
): SanitizedServiceConfig | undefined {
  const config = configurations[serviceType];
  if (!config) return undefined;

  return sanitizeServiceConfig(serviceType, config as ServiceConfig<T>);
}

/**
 * Update configuration for a specific service
 */
export function updateServiceConfig<T extends AiServiceType>(serviceType: T, config: ServiceConfig<T>): void {
  const currentConfig = configurations[serviceType] || {};

  // Only handle API key for services that use it
  const updatedConfig: ServiceConfig<T> = {
    ...currentConfig,
    ...config,
  };

  // For services that use API key, preserve the existing one if not provided
  if (serviceType !== 'vertex-ai' && serviceType !== 'vertex-ai-claude') {
    updatedConfig.apiKey = config.apiKey || currentConfig.apiKey;
  }

  if (serviceType === 'openai') {
    (updatedConfig as ServiceConfigRequirements['openai']).openaiBaseUrl =
      'openaiBaseUrl' in config ? config.openaiBaseUrl : undefined;
  }

  configurations[serviceType] = updatedConfig as ServiceConfigurations[T];
}

/**
 * Helper method to sanitize a service configuration by removing sensitive data
 */
function sanitizeServiceConfig<T extends AiServiceType>(
  serviceType: T,
  config: ServiceConfig<T>,
): SanitizedServiceConfig {
  if (serviceType === 'vertex-ai' || serviceType === 'vertex-ai-claude') {
    return {
      modelOverrides: config.modelOverrides,
      googleCloudProjectId: config.googleCloudProjectId,
      googleCloudRegion: serviceType === 'vertex-ai-claude' ? config.googleCloudRegion : undefined,
      hasApiKey: false,
    };
  } else {
    return {
      openaiBaseUrl: serviceType === 'openai' && 'openaiBaseUrl' in config ? config.openaiBaseUrl : undefined,
      modelOverrides: config.modelOverrides,
      hasApiKey: !!config.apiKey,
    };
  }
}
