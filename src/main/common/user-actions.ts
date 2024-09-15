type InputHandler = (prompt: string, message: string) => Promise<string>;

type ConfirmHandler = (prompt: string, defaultValue: boolean) => Promise<boolean>;

export async function askUserForInput(prompt: string, message: string): Promise<string> {
  return await inputHandler(prompt, message);
}

export async function askUserForConfirmation(prompt: string, defaultValue: boolean): Promise<boolean> {
  return await confirmHandler(prompt, defaultValue);
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}
