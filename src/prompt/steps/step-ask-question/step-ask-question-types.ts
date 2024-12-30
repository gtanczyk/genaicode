import {
  FunctionCall,
  GenerateContentFunction,
  GenerateImageFunction,
  PromptItem,
  PromptItemImage,
} from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { PluginActionType } from '../../../main/codegen-types.js';

export type ActionType =
  | 'codeGeneration'
  | 'sendMessage'
  | 'sendMessageWithImage'
  | 'requestPermissions'
  | 'requestFilesContent'
  | 'removeFilesFromContext'
  | 'confirmCodeGeneration'
  | 'cancelCodeGeneration'
  | 'contextOptimization'
  | 'searchCode'
  | 'lint'
  | PluginActionType;

type AskQuestionArgs = {
  steps: [
    {
      type: 'decisionMakingProcess';
      value: string;
    },
    {
      type: 'actionType';
      value: ActionType;
    },
    {
      type: 'message';
      value: string;
    },
  ];
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

/**
 * Arguments for the searchCode action
 */
export type SearchCodeArgs = {
  /** The search query string */
  query: string;
  /** Optional glob patterns to include files */
  includePatterns?: string[];
  /** Optional glob patterns to exclude files */
  excludePatterns?: string[];
  /** Whether to search in file contents (default: true) */
  searchInContent?: boolean;
  /** Whether to search in file names (default: true) */
  searchInFilenames?: boolean;
  /** Case sensitive search (default: false) */
  caseSensitive?: boolean;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Number of context lines to include around content matches */
  contextLines?: number;
};

export type LintResult = {
  success: boolean;
  stdout?: string;
  stderr?: string;
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
  data?: Record<string, unknown>;
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
  executeCodegen?: boolean;
  stepResult?: FunctionCall[];
  items: Array<{
    assistant: AssistantItem;
    user: UserItem;
  }>;
  lintResult?: LintResult;
}

export type ActionHandlerProps = {
  askQuestionCall: AskQuestionCall;
  askQuestionMessage: string | undefined;
  prompt: PromptItem[];
  options: CodegenOptions;
  generateContentFn: GenerateContentFunction;
  generateImageFn: GenerateImageFunction;
  waitIfPaused: () => Promise<void>;
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;
