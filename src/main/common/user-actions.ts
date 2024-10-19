type InputHandler = (prompt: string, message: string) => Promise<string>;

type ConfirmHandlerResponse = {
  confirmed: boolean | undefined;
  answer?: string;
};

type ConfirmHandler = (
  prompt: string,
  includeAnswer: boolean,
  defaultValue: boolean,
) => Promise<ConfirmHandlerResponse>;

export async function askUserForInput(prompt: string, message: string): Promise<string> {
  return await inputHandler(prompt, message);
}

export async function askUserForConfirmation(prompt: string, defaultValue: boolean): Promise<ConfirmHandlerResponse> {
  return await confirmHandler(prompt, false, defaultValue);
}

export async function askUserForConfirmationWithAnswer(
  prompt: string,
  defaultValue: boolean,
): Promise<ConfirmHandlerResponse> {
  return await confirmHandler(prompt, true, defaultValue);
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}
