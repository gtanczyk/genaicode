import { input, confirm } from '@inquirer/prompts';

import { registerInputHandler, registerConfirmHandler, ConfirmHandlerProps } from '../common/user-actions.js';

export function registerUserActionHandlers() {
  registerInputHandler(askUserForInput);
  registerConfirmHandler(askUserForConfirmation);
}

async function askUserForInput(prompt: string): Promise<string> {
  return await input({ message: prompt });
}

async function askUserForConfirmation({ prompt, defaultValue }: ConfirmHandlerProps): Promise<{ confirmed: boolean }> {
  return { confirmed: await confirm({ message: prompt, default: defaultValue }) };
}
