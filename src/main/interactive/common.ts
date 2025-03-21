import { select, Separator } from '@inquirer/prompts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../../package.json');

export const displayWelcome = () => {
  console.log(`Welcome to Genaicode v${packageJson.version}`);
};

export type UserAction =
  | 'text_prompt'
  | 'task_file'
  | 'select_ai_service'
  | 'configure'
  | 'help'
  | 'exit'
  | 're_run'
  | 'main_menu'
  | 'interrupt';

const getUserActionChoices = () =>
  [
    { name: 'Enter a text prompt', value: 'text_prompt' },
    { name: 'Select a task file', value: 'task_file' },
    new Separator(),
    { name: 'Select AI service', value: 'select_ai_service' },
    { name: 'Configuration', value: 'configure' },
    { name: 'Print help', value: 'help' },
    new Separator(),
    { name: 'Exit', value: 'exit' },
  ] as const;

export const getUserAction = async (): Promise<UserAction> => {
  const choices = getUserActionChoices();
  return await select<UserAction>({
    message: 'What would you like to do?',
    pageSize: choices.length,
    choices,
  });
};

export const handleCodegenError = async (error: Error): Promise<UserAction> => {
  console.error('An error occurred during code generation:');
  console.error(error.message);

  const choices = [
    { name: 'Re-run the operation', value: 're_run' },
    { name: 'Return to main menu', value: 'main_menu' },
  ] as const;

  return await select<UserAction>({
    message: 'How would you like to proceed?',
    pageSize: choices.length,
    choices,
  });
};

export const confirmAction = async (message: string): Promise<boolean> => {
  const choices = [
    { name: 'Yes', value: true },
    { name: 'No, return to main menu', value: false },
  ];

  return await select<boolean>({
    message,
    choices,
  });
};
