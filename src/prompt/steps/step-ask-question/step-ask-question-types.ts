import {
  FunctionCall,
  GenerateContentFunction,
  GenerateImageFunction,
  PromptItem,
  PromptItemImage,
} from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { StepResult } from '../steps-types.js';
import { PluginActionType } from '../../../main/codegen-types.js';

export type ActionType =
  | 'sendMessage'
  | 'sendMessageWithImage'
  | 'requestPermissions'
  | 'requestFilesContent'
  | 'removeFilesFromContext'
  | 'confirmCodeGeneration'
  | 'cancelCodeGeneration'
  | 'contextOptimization'
  | PluginActionType;

type AskQuestionArgs = {
  actionType: ActionType;
  message: string;
};

export type SendMessageWithImageArgs = {
  prompt: string;
  contextImage?: string;
};

export type RequestPermissionsArgs = Record<
  'allowDirectoryCreate' | 'allowFileCreate' | 'allowFileDelete' | 'allowFileMove' | 'enableVision' | 'enableImagen',
  boolean
>;

export type RequestFilesContentArgs = {
  filePaths: string[];
};

export type RemoveFilesFromContextArgs = {
  filePaths: string[];
};

export type ContextOptimizationArgs = {
  filePaths: string[];
};

export type AskQuestionCall = FunctionCall<AskQuestionArgs>;

export interface AssistantItem {
  type: 'assistant';
  text: string;
  functionCalls?: FunctionCall[];
  images?: PromptItemImage[];
  cache?: true;
}

export interface UserItem {
  type: 'user';
  text: string;
  functionResponses?: Array<{
    name: string;
    call_id: string | undefined;
    content: string | undefined;
  }>;
  images?: PromptItemImage[];
  cache?: true;
}

export interface ActionResult {
  breakLoop: boolean;
  stepResult: StepResult;
  items: Array<{
    assistant: AssistantItem;
    user: UserItem;
  }>;
}

export type ActionHandlerProps = {
  askQuestionCall: AskQuestionCall;
  prompt: PromptItem[];
  options: CodegenOptions;
  generateContentFn: GenerateContentFunction;
  generateImageFn: GenerateImageFunction;
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;
