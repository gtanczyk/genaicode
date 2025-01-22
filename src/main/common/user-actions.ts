import { CodegenOptions } from '../codegen-types';

export type InputHandlerResponse = {
  answer: string;
  options?: CodegenOptions;
};

type InputHandler = (prompt: string, message: string) => Promise<InputHandlerResponse>;

type ConfirmHandlerResponse = {
  confirmed: boolean | undefined;
  options?: CodegenOptions;
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

export async function askUserForInput(
  prompt: string,
  message: string,
  options: CodegenOptions,
): Promise<InputHandlerResponse> {
  return handleOptionsUpdate(await inputHandler(prompt, message), options);
}

export async function askUserForConfirmation(
  prompt: string,
  defaultValue: boolean,
  options: CodegenOptions,
): Promise<ConfirmHandlerResponse> {
  return handleOptionsUpdate(
    await confirmHandler({
      prompt,
      confirmLabel: 'Yes',
      declineLabel: 'No',
      includeAnswer: false,
      defaultValue,
    }),
    options,
  );
}

export async function askUserForConfirmationWithAnswer(
  prompt: string,
  confirmLabel: string,
  declineLabel: string,
  defaultValue: boolean,
  options: CodegenOptions,
): Promise<ConfirmHandlerResponse> {
  return handleOptionsUpdate(
    await confirmHandler({
      prompt,
      confirmLabel,
      declineLabel,
      includeAnswer: true,
      defaultValue,
    }),
    options,
  );
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}

function handleOptionsUpdate<T extends { options?: CodegenOptions }>(response: T, options: CodegenOptions): T {
  if (response.options?.aiService) {
    options.aiService = response.options.aiService;
  }
  if (response.options?.cheap) {
    options.cheap = response.options.cheap;
  }

  return response;
}
