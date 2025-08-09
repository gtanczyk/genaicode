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
      default: modelOverrides.aiStudio?.default ?? 'gemini-2.5-pro',
      cheap: modelOverrides.aiStudio?.cheap ?? 'gemini-2.5-flash',
      lite: modelOverrides.aiStudio?.lite ?? 'gemini-2.5-flash-lite',
      reasoning: modelOverrides.aiStudio?.reasoning ?? 'gemini-2.5-pro',
      modelSpecificSettings: Object.assign({}, modelOverrides.aiStudio?.modelSpecificSettings ?? {}, {
        'gemini-2.5-flash-lite': {
          thinkingBudget: 24576,
          thinkingEnabled: true,
        },
      }),
    },
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    modelOverrides: {
      default: modelOverrides.anthropic?.default ?? 'claude-sonnet-4-20250514',
      cheap: modelOverrides.anthropic?.cheap ?? 'claude-3-5-haiku-20241022',
      lite: modelOverrides.anthropic?.lite ?? 'claude-3-5-haiku-20241022',
      reasoning: modelOverrides.anthropic?.reasoning ?? 'claude-sonnet-4-20250514',
      modelSpecificSettings: modelOverrides.anthropic?.modelSpecificSettings ?? {},
    },
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    modelOverrides: {
      default: modelOverrides.openai?.default ?? 'gpt-5',
      cheap: modelOverrides.openai?.cheap ?? 'gpt-5-mini',
      lite: modelOverrides.openai?.lite ?? 'gpt-5-nano',
      reasoning: modelOverrides.openai?.reasoning ?? 'gpt-5',
      modelSpecificSettings: modelOverrides.openai?.modelSpecificSettings ?? {
        'gpt-5': {
          temperatureUnsupported: true,
        },
        'gpt-5-mini': {
          temperatureUnsupported: true,
        },
        'gpt-5-nano': {
          temperatureUnsupported: true,
        },
      },
    },
  },
  'github-models': {
    apiKey: process.env.GITHUB_TOKEN,
    modelOverrides: {
      default: modelOverrides.githubModels?.default ?? 'gpt-4o',
      cheap: modelOverrides.githubModels?.cheap ?? 'gpt-4o-mini',
      lite: modelOverrides.githubModels?.lite ?? 'gpt-4o-mini',
      reasoning: modelOverrides.githubModels?.reasoning ?? 'o1-mini',
      modelSpecificSettings: modelOverrides.githubModels?.modelSpecificSettings ?? {},
    },
  },
  'local-llm': {
    apiKey: process.env.LOCAL_LLM_API_KEY ?? 'local-llm',
    openaiBaseUrl: process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:11434/v1/',
    modelOverrides: {
      default: modelOverrides.localLlm?.default ?? 'gemma3:12b',
      cheap: modelOverrides.localLlm?.cheap ?? 'gemma3:12b',
      lite: modelOverrides.localLlm?.lite ?? 'gemma3:12b',
      reasoning: modelOverrides.localLlm?.reasoning ?? 'gemma3:12b',
      modelSpecificSettings: modelOverrides.localLlm?.modelSpecificSettings ?? {},
    },
  },
  'vertex-ai': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    modelOverrides: {
      default: modelOverrides.vertexAi?.default ?? 'gemini-2.5-pro',
      cheap: modelOverrides.vertexAi?.cheap ?? 'gemini-2.5-flash',
      lite: modelOverrides.vertexAi?.lite ?? 'gemini-2.5-flash-lite',
      reasoning: modelOverrides.vertexAi?.reasoning ?? 'gemini-2.5-pro',
      modelSpecificSettings: modelOverrides.vertexAi?.modelSpecificSettings ?? {},
    },
  },
  'vertex-ai-claude': {
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    googleCloudRegion: process.env.GOOGLE_CLOUD_REGION ?? '',
    modelOverrides: {
      default: 'claude-3-5-sonnet@20240620',
      cheap: 'claude-3-haiku@20240307',
      lite: 'claude-3-haiku@20240307',
      reasoning: 'claude-3-5-sonnet@20240620',
    },
  },
};

// Merge plugin configurations
[...getRegisteredAiServices().entries()].forEach(([serviceType, service]) => {
  const existingConfig = configurations[serviceType] ?? {};
  const pluginConfig = service.serviceConfig ?? {};

  configurations[serviceType] = {
    ...existingConfig,
    ...pluginConfig,
    modelOverrides: {
      // Keep existing model type defaults (cheap, default, reasoning)
      ...existingConfig.modelOverrides,
      // Apply plugin model type defaults
      ...pluginConfig.modelOverrides,
      // Merge modelSpecificSettings deeply
      modelSpecificSettings: {
        ...(existingConfig.modelOverrides?.modelSpecificSettings ?? {}),
        ...(pluginConfig.modelOverrides?.modelSpecificSettings ?? {}),
      },
    },
  };
});

/**
 * Get settings for a specific model within a service.
 * Returns systemInstruction and outputTokenLimit, falling back to defaults if not specified.
 */
export function getModelSettings(
  serviceType: AiServiceType,
  modelName: string,
): {
  systemInstruction?: string[];
  outputTokenLimit?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  temperatureUnsupported?: boolean;
} {
  const serviceConfig = configurations[serviceType];
  const modelSpecificSettings = serviceConfig?.modelOverrides?.modelSpecificSettings?.[modelName];

  return {
    systemInstruction: modelSpecificSettings?.systemInstruction,
    outputTokenLimit: modelSpecificSettings?.outputTokenLimit,
    thinkingEnabled: modelSpecificSettings?.thinkingEnabled,
    thinkingBudget: modelSpecificSettings?.thinkingBudget,
    temperatureUnsupported: modelSpecificSettings?.temperatureUnsupported,
  };
}

/**
 * Get all service configurations.
 * This method returns the full configurations including sensitive data.
 * For external use, prefer getSanitizedConfigurations().
 * @internal
 */
export function getServiceConfigurations(): ServiceConfigurations {
  return configurations;
}

/**
 * Get configuration for a specific service.
 * This method returns the full configuration including sensitive data.
 * For external use, prefer getSanitizedConfiguration().
 * @internal
 */
export function getServiceConfig<T extends AiServiceType>(serviceType: T): ServiceConfig<T> {
  // Ensure the returned config conforms to the ServiceConfig type
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
export function updateServiceConfig<T extends AiServiceType>(serviceType: T, config: Partial<ServiceConfig<T>>): void {
  const currentConfig = configurations[serviceType] || {};

  // Merge the new partial config with the current config
  const updatedConfig: ServiceConfig<T> = {
    ...currentConfig,
    ...config,
    modelOverrides: {
      ...(currentConfig.modelOverrides ?? {}),
      ...(config.modelOverrides ?? {}),
      // Deep merge modelSpecificSettings
      modelSpecificSettings: {
        ...(currentConfig.modelOverrides?.modelSpecificSettings ?? {}),
        ...(config.modelOverrides?.modelSpecificSettings ?? {}),
      },
    },
  } as ServiceConfig<T>;

  // Preserve sensitive fields if not provided in the update
  if (
    serviceType !== 'vertex-ai' &&
    serviceType !== 'vertex-ai-claude' &&
    !('apiKey' in config) && // Check if apiKey is explicitly in the partial update
    'apiKey' in currentConfig // Check if apiKey exists in the current config
  ) {
    updatedConfig.apiKey = currentConfig.apiKey;
  }

  if ((serviceType === 'openai' || serviceType === 'local-llm') && !('openaiBaseUrl' in config)) {
    const currentOpenAiConfig = currentConfig as ServiceConfigRequirements['openai'];
    if (currentOpenAiConfig?.openaiBaseUrl) {
      (updatedConfig as ServiceConfigRequirements['openai']).openaiBaseUrl = currentOpenAiConfig.openaiBaseUrl;
    }
  }

  if (serviceType === 'vertex-ai' && !('googleCloudProjectId' in config)) {
    const currentVertexConfig = currentConfig as ServiceConfigRequirements['vertex-ai'];
    if (currentVertexConfig?.googleCloudProjectId) {
      (updatedConfig as ServiceConfigRequirements['vertex-ai']).googleCloudProjectId =
        currentVertexConfig.googleCloudProjectId;
    }
  }

  if (serviceType === 'vertex-ai-claude') {
    if (!('googleCloudProjectId' in config)) {
      const currentVertexClaudeConfig = currentConfig as ServiceConfigRequirements['vertex-ai-claude'];
      if (currentVertexClaudeConfig?.googleCloudProjectId) {
        (updatedConfig as ServiceConfigRequirements['vertex-ai-claude']).googleCloudProjectId =
          currentVertexClaudeConfig.googleCloudProjectId;
      }
    }
    if (!('googleCloudRegion' in config)) {
      const currentVertexClaudeConfig = currentConfig as ServiceConfigRequirements['vertex-ai-claude'];
      if (currentVertexClaudeConfig?.googleCloudRegion) {
        (updatedConfig as ServiceConfigRequirements['vertex-ai-claude']).googleCloudRegion =
          currentVertexClaudeConfig.googleCloudRegion;
      }
    }
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
  const hasModelSpecificSettings =
    !!config.modelOverrides?.modelSpecificSettings &&
    Object.keys(config.modelOverrides.modelSpecificSettings).length > 0;

  const sanitizedBase = {
    modelOverrides: {
      default: config.modelOverrides?.default,
      cheap: config.modelOverrides?.cheap,
      lite: config.modelOverrides?.lite,
      reasoning: config.modelOverrides?.reasoning,
      // Indicate if any model-specific settings exist, but don't expose them
      hasModelSpecificSettings,
    },
  };

  if (serviceType === 'vertex-ai' || serviceType === 'vertex-ai-claude') {
    return {
      ...sanitizedBase,
      googleCloudProjectId: config.googleCloudProjectId,
      googleCloudRegion: serviceType === 'vertex-ai-claude' ? config.googleCloudRegion : undefined,
      hasApiKey: false, // Vertex services don't use API keys directly in this context
    };
  } else {
    const openAiBaseUrl =
      (serviceType === 'openai' || serviceType === 'local-llm') && 'openaiBaseUrl' in config
        ? config.openaiBaseUrl
        : undefined;
    return {
      ...sanitizedBase,
      openaiBaseUrl: openAiBaseUrl,
      hasApiKey: !!config.apiKey,
    };
  }
}
