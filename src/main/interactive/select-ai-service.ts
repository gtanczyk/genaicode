import { select } from '@inquirer/prompts';
import { AiServiceType } from '../codegen-types.js';

const AI_SERVICE_CHOICES = [
  { name: 'Vertex AI (Gemini)', value: 'vertex-ai' },
  { name: 'AI Studio (Gemini)', value: 'ai-studio' },
  { name: 'ChatGPT', value: 'chat-gpt' },
  { name: 'Anthropic Claude', value: 'anthropic' },
  { name: 'Claude via Vertex AI', value: 'vertex-ai-claude' },
] as const;

export const selectAiService = async (defaultAiService: AiServiceType | undefined): Promise<AiServiceType> => {
  try {
    const selectedAiService = await select<AiServiceType>({
      message: 'Select the AI model you want to use:',
      pageSize: AI_SERVICE_CHOICES.length,
      choices: AI_SERVICE_CHOICES.map((choice) => ({
        ...choice,
        checked: defaultAiService === choice.value,
      })),
      default: defaultAiService,
    });

    return selectedAiService;
  } catch (error) {
    console.error('Error selecting AI service:', error);
    throw error;
  }
};

// Helper function to validate AI service type
export const isValidAiServiceType = (service: string): service is AiServiceType => {
  return AI_SERVICE_CHOICES.some((choice) => choice.value === service);
};

// Helper function to get AI service name
export const getAiServiceName = (service: AiServiceType): string => {
  const choice = AI_SERVICE_CHOICES.find((choice) => choice.value === service);
  return choice ? choice.name : 'Unknown Service';
};
