import { input, confirm, password } from '@inquirer/prompts';

import {
  registerInputHandler,
  registerConfirmHandler,
  ConfirmHandlerProps,
  InputHandlerResponse,
  registerSecretHandler,
} from '../common/user-actions.js';

export function registerUserActionHandlers() {
  registerInputHandler(askUserForInput);
  registerConfirmHandler(askUserForConfirmation);
  registerSecretHandler(askUserForSecret);
}

async function askUserForInput(prompt: string): Promise<InputHandlerResponse> {
  return {
    answer: await input({ message: prompt }),
  };
}

async function askUserForConfirmation({ prompt, defaultValue }: ConfirmHandlerProps): Promise<{ confirmed: boolean }> {
  return { confirmed: await confirm({ message: prompt, default: defaultValue }) };
}

async function askUserForSecret(prompt: string): Promise<string | undefined> {
  const secret = await password({ message: prompt, mask: true });
  return secret || undefined;
}
