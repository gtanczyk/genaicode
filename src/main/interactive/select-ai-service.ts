import { select } from '@inquirer/prompts';
import { AiServiceType } from '../codegen-types.js';

// Function to select AI service
export const selectAiService = async (defaultAiService: AiServiceType | undefined): Promise<AiServiceType> => {
  const choices = [
    { name: 'Vertex AI (Gemini)', value: 'vertex-ai' },
    { name: 'AI Studio (Gemini)', value: 'ai-studio' },
    { name: 'ChatGPT', value: 'chat-gpt' },
    { name: 'Anthropic Claude', value: 'anthropic' },
    { name: 'Claude via Vertex AI', value: 'vertex-ai-claude' },
  ] as const;

  const selectedAiService = await select<AiServiceType>({
    message: 'Select the AI model you want to use:',
    pageSize: choices.length,
    choices: choices.map((choice) => ({ ...choice, checked: defaultAiService === choice.value })),
    default: defaultAiService,
  });

  return selectedAiService;
};
