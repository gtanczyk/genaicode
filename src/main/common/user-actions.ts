import { PromptItemImage } from '../../ai-service/common-types';
import {
  ActionType,
  StructuredQuestionForm,
  StructuredQuestionResponse,
} from '../../prompt/steps/step-ask-question/step-ask-question-types';
import { CodegenOptions } from '../codegen-types';

export type InputHandlerResponse = {
  answer: string;
  images?: PromptItemImage[];
  options?: CodegenOptions;
  selectedActionType?: ActionType | undefined;
};

type InputHandler = (prompt: string, message: string, promptActionType?: boolean) => Promise<InputHandlerResponse>;

export type ConfirmHandlerResponse = {
  confirmed: boolean | undefined;
  options?: CodegenOptions;
  answer?: string;
  selectedActionType?: ActionType | undefined;
};

export type ConfirmHandlerProps = {
  prompt: string;
  confirmLabel: string;
  declineLabel: string;
  includeAnswer: boolean;
  defaultValue: boolean;
};

type ConfirmHandler = (props: ConfirmHandlerProps) => Promise<ConfirmHandlerResponse>;
type SecretHandler = (prompt: string) => Promise<string | undefined>;
type StructuredQuestionHandler = (
  form: StructuredQuestionForm,
  options: CodegenOptions,
) => Promise<StructuredQuestionResponse>;

export async function askUserForInput(
  prompt: string,
  message: string,
  options: CodegenOptions,
  promptActionType?: boolean,
): Promise<InputHandlerResponse> {
  return handleOptionsUpdate(await inputHandler(prompt, message, promptActionType), options);
}

export async function askUserForConfirmation(
  prompt: string,
  defaultValue: boolean,
  options: CodegenOptions,
  confirmLabel = 'Yes',
  declineLabel = 'No',
): Promise<ConfirmHandlerResponse> {
  return handleOptionsUpdate(
    await confirmHandler({
      prompt,
      confirmLabel,
      declineLabel,
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

export async function askUserForSecret(prompt: string): Promise<string | undefined> {
  if (!secretHandler) {
    throw new Error('Secret handler not registered');
  }
  return await secretHandler(prompt);
}

export async function askUserForStructuredQuestion(
  form: StructuredQuestionForm,
  options: CodegenOptions,
): Promise<StructuredQuestionResponse> {
  if (!structuredQuestionHandler) {
    throw new Error('Structured question handler not registered');
  }
  return await structuredQuestionHandler(form, options);
}

let inputHandler: InputHandler;
let confirmHandler: ConfirmHandler;
let secretHandler: SecretHandler;
let structuredQuestionHandler: StructuredQuestionHandler;

export function registerInputHandler(handler: InputHandler) {
  inputHandler = handler;
}

export function registerConfirmHandler(handler: ConfirmHandler) {
  confirmHandler = handler;
}

export function registerSecretHandler(handler: SecretHandler) {
  secretHandler = handler;
}

export function registerStructuredQuestionHandler(handler: StructuredQuestionHandler) {
  structuredQuestionHandler = handler;
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
