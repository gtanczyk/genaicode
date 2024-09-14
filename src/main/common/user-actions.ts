type InputHandler = (message: string) => Promise<string>;

type ConfirmHandler = (message: string, defaultValue: boolean) => Promise<boolean>;

export async function askUserForInput(message: string): Promise<string> {
  return await inputHandler(message);
}

export async function askUserForConfirmation(message: string, defaultValue: boolean): Promise<boolean> {
  return await confirmHandler(message, defaultValue);
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}
