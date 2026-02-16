import { GenerateImageFunction } from '../../../ai-service/common-types.js';
import { GenerateContentFunction } from '../../../ai-service/common-types.js';
import { PromptItem } from '../../../ai-service/common-types.js';
import { PromptItemImage } from '../../../ai-service/common-types.js';
import { FunctionCall } from '../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { PluginActionType } from '../../../ai-service/service-configurations-types.js';
import { ConsoleLogLevel, ConsoleLogMode } from '../../../vite-genaicode/vite-genaicode-types.js';

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
  | 'updateFile'
  | 'performAnalysis'
  | 'createFile'
  | 'pullAppContext'
  | 'pullConsoleLogs'
  | 'genaicodeHelp'
  | 'pushAppContext'
  | 'reasoningInference'
  | 'requestFilesFragments'
  | 'requestGitContext'
  | 'conversationGraph'
  | 'runContainerTask'
  | 'compoundAction'
  | 'runProjectCommand'
  | 'runBashCommand'
  | 'webSearch'
  | 'structuredQuestion'
  | 'codeExecution'
  | PluginActionType;

export type IterateArgs = {
  actionType?: ActionType;
  message?: string;
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

/**
 * Arguments for pullConsoleLogs action
 */
export type PullConsoleLogsArgs = {
  mode: ConsoleLogMode;
  prompt?: string;
  lines?: number;
  level?: ConsoleLogLevel;
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
  requestType: 'commits' | 'fileChanges' | 'blame' | 'fileDiff' | 'workingChanges' | 'workingDiff';
  filePath?: string; // Required for 'fileChanges', 'blame', 'fileDiff', and 'workingDiff'
  commitHash?: string; // Required for 'blame' and 'fileDiff'
  count?: number; // Applies mainly to 'commits' and 'fileChanges'
  includeUntracked?: boolean;
  stagedOnly?: boolean;
  unstagedOnly?: boolean;
  staged?: boolean;
};

/**
 * Represents a single action within a compound action batch.
 */
export interface CompoundActionItem {
  /** The name of the operation to execute (e.g., 'createFile', 'updateFile'). */
  name: string;
  /** The parameters required by the specified actionName. */
  args: Record<string, unknown>;
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

export type RunProjectCommandArgs = {
  name: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirOverride?: string;
  truncMode?: 'first' | 'last' | 'summarize' | 'full';
};

export type RunBashCommandArgs = {
  command: string;
  env?: Record<string, string>;
  workingDirOverride?: string;
  truncMode?: 'first' | 'last' | 'summarize' | 'full';
};

export type ProjectCommandResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CodeExecutionArgs = {
  message: string;
};

export type IterateCall = FunctionCall<IterateArgs>;
export type PerformAnalysisCall = FunctionCall<PerformAnalysisArgs>;
export type AnalysisResultCall = FunctionCall<AnalysisResultArgs>;
export type ReasoningInferenceCall = FunctionCall<ReasoningInferenceArgs>;

export interface AssistantItem {
  type: 'assistant';
  text: string;
  functionCalls?: FunctionCall[];
  executableCode?: {
    language: string;
    code: string;
  };
  codeExecutionResult?: {
    outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
    output: string;
    outputFiles?: Array<{
      fileId: string;
      filename: string;
      size: number;
      mimeType?: string;
    }>;
  };
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
    isError?: boolean;
  }>;
  images?: PromptItemImage[];
  cache?: true;
}

export interface ActionResult {
  breakLoop: boolean;
  forceActionType?: ActionType;
  stepResult?: FunctionCall[];
  items: Array<{
    assistant: AssistantItem;
    user: UserItem;
  }>;
}

export type ActionHandlerProps = {
  iterateCall: IterateCall;
  prompt: PromptItem[];
  options: CodegenOptions;
  generateContentFn: GenerateContentFunction;
  generateImageFn: GenerateImageFunction;
  waitIfPaused: () => Promise<void>;
};

export type ActionHandler = (props: ActionHandlerProps) => Promise<ActionResult>;

export type StructuredQuestionFieldType = 'text' | 'checkbox' | 'radio' | 'select' | 'textarea' | 'number' | 'email';

export interface StructuredQuestionField {
  id: string;
  label: string;
  type: StructuredQuestionFieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[]; // For radio, checkbox, select
  defaultValue?: string | string[]; // For checkbox can be array
  validation?: { pattern?: string; minLength?: number; maxLength?: number };
}

export interface StructuredQuestionForm {
  title: string;
  description?: string;
  fields: StructuredQuestionField[];
  submitLabel?: string;
  cancelLabel?: string;
}

export type StructuredQuestionArgs = {
  message: string;
  form: StructuredQuestionForm;
};

export type StructuredQuestionResponse = {
  submitted: boolean;
  values: Record<string, string | string[] | boolean>;
};
