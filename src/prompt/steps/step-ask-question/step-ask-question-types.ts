import {
  FunctionCall,
  GenerateContentFunction,
  GenerateImageFunction,
  PromptItem,
} from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { StepResult } from '../steps-types.js';
import { PluginActionType } from '../../../main/codegen-types.js';

export type ActionType =
  | 'requestAnswer'
  | 'requestAnswerWithImage'
  | 'requestPermissions'
  | 'requestFilesContent'
  | 'removeFilesFromContext'
  | 'confirmCodeGeneration'
  | 'startCodeGeneration'
  | 'cancelCodeGeneration'
  | 'contextOptimization'
  | PluginActionType;

type AskQuestionArgs = {
  actionType: ActionType;
  content: string;
  imageGenerationRequest?: {
    prompt: string;
    contextImage?: string;
  };
  requestFilesContent?: string[];
  requestPermissions?: Record<
    'allowDirectoryCreate' | 'allowFileCreate' | 'allowFileDelete' | 'allowFileMove' | 'enableVision' | 'enableImagen',
    boolean
  >;
  removeFilesFromContext?: string[];
};

export type AskQuestionCall = FunctionCall<AskQuestionArgs>;

export interface AssistantItem {
  type: 'assistant';
  text: string;
  functionCalls: FunctionCall[];
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
  messages: {
    contextSourceCode: (paths: string[], pathsOnly: boolean) => string;
  };
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;

export interface SelfReflectionContext {
  improvementCount: number;
  lastImprovementTime: number;
}
