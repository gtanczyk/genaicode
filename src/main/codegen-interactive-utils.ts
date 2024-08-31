import fs from 'fs';
import { select, checkbox, Separator } from '@inquirer/prompts';
import { getSourceFiles } from '../files/find-files.js';
import { CODEGEN_TRIGGER } from '../prompt/prompt-consts.js';
import { createRequire } from 'module';
import { AiServiceType, CodegenOptions } from '../prompt/prompt-codegen.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

// Function to display the welcome message
export const displayWelcome = () => {
  console.log(`Welcome to Genaicode v${packageJson.version}`);
};

type UserAction =
  | 'text_prompt'
  | 'task_file'
  | 'process_comments'
  | 'select_ai_service'
  | 'configure'
  | 'help'
  | 'exit';

// Function to get user action
export const getUserAction = async (): Promise<UserAction> => {
  const choices = [
    { name: 'Enter a text prompt', value: 'text_prompt' },
    { name: 'Select a task file', value: 'task_file' },
    { name: `Process ${CODEGEN_TRIGGER} comments`, value: 'process_comments' },
    new Separator(),
    { name: 'Select AI service', value: 'select_ai_service' },
    { name: 'Configuration', value: 'configure' },
    { name: 'Print help', value: 'help' },
    new Separator(),
    { name: 'Exit', value: 'exit' },
  ] as const;

  const action = await select<UserAction>({
    message: 'What would you like to do?',
    pageSize: choices.length,
    choices,
  });
  return action;
};

// Function to get user options
export const getUserOptions = async (options: CodegenOptions): Promise<CodegenOptions> => {
  const choices = [
    { name: 'Allow file creation', value: 'allowFileCreate', checked: options.allowFileCreate },
    { name: 'Allow file deletion', value: 'allowFileDelete', checked: options.allowFileDelete },
    { name: 'Allow directory creation', value: 'allowDirectoryCreate', checked: options.allowDirectoryCreate },
    { name: 'Allow file moving', value: 'allowFileMove', checked: options.allowFileMove },
    { name: 'Enable vision capabilities', value: 'vision', checked: options.vision },
    // { name: 'Enable image generation', value: 'imagen' },
  ] as const;

  const selectedOptions = await checkbox({
    message: 'Select the options you want to enable:',
    choices,
    pageSize: choices.length,
  });

  return {
    ...options,
    allowFileCreate: selectedOptions.includes('allowFileCreate'),
    allowFileDelete: selectedOptions.includes('allowFileDelete'),
    allowDirectoryCreate: selectedOptions.includes('allowDirectoryCreate'),
    allowFileMove: selectedOptions.includes('allowFileMove'),
    vision: selectedOptions.includes('vision'),
    // imagen: selectedOptions.includes('imagen'),
  };
};

// Function to check for CODEGEN comments in source files
export const checkForCodegenComments = (): boolean => {
  const sourceFiles = getSourceFiles();
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(CODEGEN_TRIGGER)) {
      return true;
    }
  }
  return false;
};

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
