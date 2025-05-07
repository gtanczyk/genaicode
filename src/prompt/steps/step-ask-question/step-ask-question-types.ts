import { GenerateImageFunction } from '../../../ai-service/common-types.js';
import { GenerateContentFunction } from '../../../ai-service/common-types.js';
import { PromptItem } from '../../../ai-service/common-types.js';
import { PromptItemImage } from '../../../ai-service/common-types.js';
import { FunctionCall } from '../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { PluginActionType } from '../../../ai-service/service-configurations-types.js';

export type ActionType =
  | 'codeGeneration'
  | 'sendMessage'
  | 'generateImage'
  | 'requestPermissions'
  | 'readExternalFiles'
  | 'requestFilesContent'
  | 'removeFilesFromContext'
  | 'exploreExternalDirectories'
  | 'confirmCodeGeneration'
  | 'endConversation'
  | 'contextOptimization'
  | 'contextCompression'
  | 'searchCode'
  | 'lint'
  | 'updateFile'
  | 'performAnalysis'
  | 'createFile'
  | 'pullAppContext'
  | 'genaicodeHelp'
  | 'pushAppContext'
  | 'reasoningInference'
  | 'requestFilesFragments'
  | 'requestGitContext'
  | 'conversationGraph'
  | 'compoundAction'
  | PluginActionType;

type AskQuestionArgs = {
  actionType: ActionType;
  message: string;
  decisionMakingProcess?: string;
};

/**
 * Arguments for sendMessage action
 */
export type SendMessageArgs = { message: string };

/**
 * Arguments for help action
 */
export type GenaicodeHelpArgs = {
  reasoning: string;
  message: string;
};

/**
 * Arguments for pullAppContext action
 */
export type PullAppContextArgs = {
  reason: string;
  key: string;
};

/**
 * Arguments for pushAppContext action
 */
export type PushAppContextArgs = {
  reason: string;
  key: string;
  value: string;
};

export type GenerateImageArgs = {
  prompt: string;
  filePath: string;
  contextImagePath?: string;
  width: number;
  height: number;
  cheap: boolean;
};

export type RequestPermissionsArgs = Record<
  'allowDirectoryCreate' | 'allowFileCreate' | 'allowFileDelete' | 'allowFileMove' | 'enableVision' | 'enableImagen',
  boolean
>;

export type RequestFilesContentArgs = {
  filePaths: string[];
};

export type RequestFilesFragmentsArgs = {
  /** Array of file paths to extract fragments from */
  filePaths: string[];
  /** Prompt describing what information should be extracted from the files */
  fragmentPrompt: string;
};

export type ReadExternalFilesArgs = {
  externalFilePaths: string[];
  reason: string;
};

export type RemoveFilesFromContextArgs = {
  filePaths: string[];
};

export type ContextOptimizationArgs = {
  filePaths: string[];
};

/**
 * Arguments for the performAnalysis action
 */
export type PerformAnalysisArgs = {
  /** The type of analysis to perform */
  analysisType: 'code' | 'image' | 'security' | 'performance' | 'architecture' | 'general';
  /** The analysis prompt describing what needs to be analyzed */
  prompt: string;
};

/**
 * Results of the analysis operation
 */
export type AnalysisResultArgs = {
  /** Reasoning behind the analysis results */
  reasoning: string;
  /** User-friendly message summarizing results */
  message: string;
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

/**
 * Arguments for the reasoningInference action
 */
export type ReasoningInferenceArgs = {
  /** The prompt to send to the reasoning model */
  prompt: string;
  /** The context paths to provide to the reasoning model */
  contextPaths: string[];
};

/**
 * Results from the reasoning model
 */
export type ReasoningInferenceResponseArgs = {
  /** The generated response text */
  response: string;
  /** The reasoning tokens provided by the model */
  reasoning: string;
};

export type RequestGitContextArgs = {
  requestType: 'commits' | 'fileChanges' | 'blame' | 'fileDiff'; // Added fileDiff
  filePath?: string; // Required for 'fileChanges', 'blame', and 'fileDiff'
  commitHash?: string; // Required for 'blame' and 'fileDiff'
  count?: number; // Applies mainly to 'commits' and 'fileChanges'
};

export type LintResult = {
  success: boolean;
  stdout?: string;
  stderr?: string;
};

/**
 * Represents a single action within a compound action batch.
 */
export interface CompoundActionItem {
  /** The name of the operation to execute (e.g., 'createFile', 'updateFile'). */
  actionName: string;
  /** The parameters required by the specified actionName. */
  params: Array<{
    /** The name of the parameter required by the action. */
    paramName: string;
    /** The value of the parameter required by the action. */
    paramValue: string;
  }>;
}

/**
 * Arguments for the internal `compoundActionList` function call.
 */
export type CompoundActionListArgs = {
  /** An array of actions to be executed as part of a compound operation. */
  actions: CompoundActionItem[];
  /** Summary of the actions to be performed. */
  summary?: string;
};

export type AskQuestionCall = FunctionCall<AskQuestionArgs>;
export type PerformAnalysisCall = FunctionCall<PerformAnalysisArgs>;
export type AnalysisResultCall = FunctionCall<AnalysisResultArgs>;
export type ReasoningInferenceCall = FunctionCall<ReasoningInferenceArgs>;

export interface AssistantItem {
  type: 'assistant';
  text: string;
  functionCalls?: FunctionCall[];
  images?: PromptItemImage[];
  cache?: true;
}

export interface UserItem {
  type: 'user';
  text?: string;
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
  stepResult?: FunctionCall[];
  items: Array<{
    assistant: AssistantItem;
    user: UserItem;
  }>;
  lintResult?: LintResult;
}

export type ActionHandlerProps = {
  askQuestionCall: AskQuestionCall;
  prompt: PromptItem[];
  options: CodegenOptions;
  generateContentFn: GenerateContentFunction;
  generateImageFn: GenerateImageFunction;
  waitIfPaused: () => Promise<void>;
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;
