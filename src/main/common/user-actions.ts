import { CodegenOptions } from '../codegen-types';

export type InputHandlerResponse = {
  answer: string;
  options?: CodegenOptions;
};

type InputHandler = (prompt: string, message: string) => Promise<InputHandlerResponse>;

type ConfirmHandlerResponse = {
  confirmed: boolean | undefined;
  answer?: string;
};

export type ConfirmHandlerProps = {
  prompt: string;
  confirmLabel: string;
  declineLabel: string;
  includeAnswer: boolean;
  defaultValue: boolean;
};

type ConfirmHandler = (props: ConfirmHandlerProps) => Promise<ConfirmHandlerResponse>;

export async function askUserForInput(prompt: string, message: string): Promise<InputHandlerResponse> {
  return await inputHandler(prompt, message);
}

export async function askUserForConfirmation(prompt: string, defaultValue: boolean): Promise<ConfirmHandlerResponse> {
  return await confirmHandler({
    prompt,
    confirmLabel: 'Yes',
    declineLabel: 'No',
    includeAnswer: false,
    defaultValue,
  });
}

export async function askUserForConfirmationWithAnswer(
  prompt: string,
  confirmLabel: string,
  declineLabel: string,
  defaultValue: boolean,
): Promise<ConfirmHandlerResponse> {
  return await confirmHandler({
    prompt,
    confirmLabel,
    declineLabel,
    includeAnswer: true,
    defaultValue,
  });
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}
