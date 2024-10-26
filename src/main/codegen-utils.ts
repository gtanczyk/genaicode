import { AiServiceType } from './codegen-types';
import { getRegisteredAiServices } from './plugin-loader.js';

export function getSupportedAiServices(): AiServiceType[] {
  return ['vertex-ai', 'ai-studio', 'vertex-ai-claude', 'chat-gpt', 'anthropic', ...getRegisteredAiServices().keys()];
}

export function stringToAiServiceType(aiService: string | undefined | null): AiServiceType {
  if (!aiService) {
    throw new Error('Please specify which AI service should be used with --ai-service option');
  }

  // Validate that the provided AI service is supported
  const supportedServices = getSupportedAiServices();
  if (!supportedServices.includes(aiService as AiServiceType)) {
    throw new Error(`Unsupported AI service: ${aiService}. Supported services are: ${supportedServices.join(', ')}`);
  }

  return aiService as AiServiceType;
}
