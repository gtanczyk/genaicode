import { input, confirm } from '@inquirer/prompts';

import { registerInputHandler, registerConfirmHandler } from '../common/user-actions.js';

export function registerUserActionHandlers() {
  registerInputHandler(askUserForInput);
  registerConfirmHandler(askUserForConfirmation);
}

async function askUserForInput(message: string): Promise<string> {
  return await input({ message });
}

async function askUserForConfirmation(message: string, defaultValue: boolean): Promise<boolean> {
  return await confirm({ message, default: defaultValue });
}
