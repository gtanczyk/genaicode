import { select } from '@inquirer/prompts';
import { AiServiceType } from '../codegen-types.js';

const AI_SERVICE_CHOICES = [
  { name: 'Vertex AI (Gemini)', value: 'vertex-ai' },
  { name: 'AI Studio (Gemini)', value: 'ai-studio' },
  { name: 'OpenAI', value: 'openai' },
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
