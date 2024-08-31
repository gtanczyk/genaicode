import { select, Separator } from '@inquirer/prompts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../../package.json');

// Function to display the welcome message
export const displayWelcome = () => {
  console.log(`Welcome to Genaicode v${packageJson.version}`);
};

export type UserAction =
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
    { name: 'Process @CODEGEN comments', value: 'process_comments' },
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
