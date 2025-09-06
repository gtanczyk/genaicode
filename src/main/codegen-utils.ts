import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { getRegisteredAiServices } from './plugin-loader.js';

export function getSupportedAiServices(): AiServiceType[] {
  return [
    'vertex-ai',
    'ai-studio',
    'vertex-ai-claude',
    'openai',
    'anthropic',
    'local-llm',
    'github-models',
    ...getRegisteredAiServices().keys(),
  ];
}

/**
 * Returns a formatted string of supported AI services and their required environment variables.
 * @returns {string} A string containing the list of AI services and their environment variables.
 */
export function getAiServiceInfo(): string {
  const serviceInfo: Record<AiServiceType, string[]> = {
    'vertex-ai': ['GOOGLE_CLOUD_PROJECT'],
    'ai-studio': ['API_KEY'],
    'vertex-ai-claude': ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_REGION'],
    openai: ['OPENAI_API_KEY', 'OPENAI_BASE_URL (optional)'],
    anthropic: ['ANTHROPIC_API_KEY'],
    'local-llm': ['LOCAL_LLM_API_KEY (optional)', 'LOCAL_LLM_BASE_URL (optional)'],
    'github-models': ['GITHUB_TOKEN'],
  };

  let info = 'Supported AI services and their required environment variables:\n';
  for (const [service, vars] of Object.entries(serviceInfo)) {
    info += `  - ${service}: ${vars.join(', ')}\n`;
  }
  return info;
}

export function stringToAiServiceType(aiService: string | undefined | null): AiServiceType {
  if (!aiService) {
    throw new Error(
      `Please specify which AI service should be used with --ai-service option.\n\n${getAiServiceInfo()}`,
    );
  }

  // Validate that the provided AI service is supported
  const supportedServices = getSupportedAiServices();
  if (!supportedServices.includes(aiService as AiServiceType)) {
    throw new Error(`Unsupported AI service: ${aiService}. Supported services are: ${supportedServices.join(', ')}`);
  }

  return aiService as AiServiceType;
}
