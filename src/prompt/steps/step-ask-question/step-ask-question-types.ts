import { FunctionCall, GenerateContentFunction, PromptItem } from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { StepResult } from '../steps-types.js';
import { PluginActionType } from '../../../main/codegen-types.js';

export type ActionType =
  | 'requestAnswer'
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
    call_id: string;
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
  messages: {
    contextSourceCode: (paths: string[], pathsOnly: boolean) => string;
  };
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;

// Self-reflection related types
export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: string;
}

export interface SelfReflectionContext {
  escalationCount: number;
  lastEscalationTime: number;
}
