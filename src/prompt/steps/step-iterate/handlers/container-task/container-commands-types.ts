import Docker from 'dockerode';
import {
  FunctionCall,
  GenerateContentFunction,
  PromptItem,
  FunctionDef,
} from '../../../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../../../main/codegen-types.js';

// Centralized Base Props and Result Types
export interface CommandHandlerBaseProps {
  actionResult: FunctionCall;
  systemPrompt: PromptItem;
  taskPrompt: PromptItem;
  taskExecutionPrompt: PromptItem[];
  generateContentFn: GenerateContentFunction;
  container: Docker.Container;
  options: CodegenOptions;
  maxContextItems: number;
  maxContextSize: number;
  maxOutputLength: number;
}

export type CommandHandlerResult = void | {
  success?: boolean;
  summary?: string;
  commandsExecutedIncrement?: number;
  shouldBreakOuter?: boolean;
};

// A generic type for command handlers to make the registry simpler.
// The execution loop will be responsible for passing the correct props.
export interface CommandHandler<T extends CommandHandlerBaseProps = CommandHandlerBaseProps> {
  (props: T): Promise<CommandHandlerResult>;
}

export interface Command<T extends CommandHandlerBaseProps = CommandHandlerBaseProps> {
  def: FunctionDef | (() => FunctionDef);
  handler: CommandHandler<T>;
}
