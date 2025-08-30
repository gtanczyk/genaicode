import Docker from 'dockerode';
import {
  FunctionCall,
  GenerateContentFunction,
  PromptItem,
  FunctionDef,
} from '../../../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../../../main/codegen-types.js';

import { completeTaskDef, handleCompleteTask } from './commands/complete-task.js';
import { failTaskDef, handleFailTask } from './commands/fail-task.js';
import { wrapContextDef, handleWrapContext, HandleWrapContextProps } from './commands/wrap-context.js';
import { setExecutionPlanDef, handleSetExecutionPlan } from './commands/set-execution-plan.js';
import { updateExecutionPlanDef, handleUpdateExecutionPlan } from './commands/update-execution-plan.js';
import { sendMessageDef, handleSendMessage } from './commands/send-message.js';
import { runCommandDef, handleRunCommand, HandleRunCommandProps } from './commands/run-command.js';
import { getCopyToContainerDef, handleCopyToContainer } from './commands/copy-to-container.js';
import { checkContextDef, handleCheckContext, CheckContextProps } from './commands/check-context.js';
import { getCopyFromContainerDef, handleCopyFromContainer } from './commands/copy-from-container.js';
import { handleWebSearch } from './commands/web-search.js';
import { webSearchDef } from '../../../../function-defs/web-search.js';
import { requestSecretDef, handleRequestSecret } from './commands/request-secret.js';
import { gainKnowledgeDef, handleGainKnowledge } from './commands/gain-knowledge.js';
import { queryKnowledgeDef, handleQueryKnowledge } from './commands/query-knowledge.js';

// Centralized Base Props and Result Types
export interface CommandHandlerBaseProps {
  actionResult: FunctionCall;
  taskExecutionPrompt: PromptItem[];
  generateContentFn: GenerateContentFunction;
  container: Docker.Container;
  options: CodegenOptions;
  computeContextMetrics: () => { messageCount: number; estimatedTokens: number };
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

// Re-export shared types for use in the execution loop
export type { HandleWrapContextProps, HandleRunCommandProps, CheckContextProps };

// A generic type for command handlers to make the registry simpler.
// The execution loop will be responsible for passing the correct props.
export interface CommandHandler<T extends CommandHandlerBaseProps = CommandHandlerBaseProps> {
  (props: T): Promise<CommandHandlerResult>;
}

interface Command<T extends CommandHandlerBaseProps = CommandHandlerBaseProps> {
  def: FunctionDef | (() => FunctionDef);
  handler: CommandHandler<T>;
}

const commandRegistry = new Map<string, Command>();

function registerCommand<T extends CommandHandlerBaseProps>(
  name: string,
  def: FunctionDef | (() => FunctionDef),
  handler: CommandHandler<T>,
) {
  commandRegistry.set(name, { def, handler: handler as CommandHandler<CommandHandlerBaseProps> });
}

// Register all available commands
registerCommand('completeTask', completeTaskDef, handleCompleteTask);
registerCommand('failTask', failTaskDef, handleFailTask);
registerCommand('wrapContext', wrapContextDef, handleWrapContext);
registerCommand('setExecutionPlan', setExecutionPlanDef, handleSetExecutionPlan);
registerCommand('updateExecutionPlan', updateExecutionPlanDef, handleUpdateExecutionPlan);
registerCommand('sendMessage', sendMessageDef, handleSendMessage);
registerCommand('runCommand', runCommandDef, handleRunCommand);
registerCommand('copyToContainer', getCopyToContainerDef, handleCopyToContainer);
registerCommand('checkContext', checkContextDef, handleCheckContext);
registerCommand('copyFromContainer', getCopyFromContainerDef, handleCopyFromContainer);
registerCommand('webSearch', webSearchDef, handleWebSearch);
registerCommand('requestSecret', requestSecretDef, handleRequestSecret);
registerCommand('gainKnowledge', gainKnowledgeDef, handleGainKnowledge);
registerCommand('queryKnowledge', queryKnowledgeDef, handleQueryKnowledge);

/**
 * Gets all function definitions for the container commands.
 * It resolves any definition functions into concrete FunctionDef objects.
 */
export function getContainerCommandDefs(): FunctionDef[] {
  return Array.from(commandRegistry.values()).map((command) => {
    return typeof command.def === 'function' ? command.def() : command.def;
  });
}

/**
 * Gets the handler for a specific command by name.
 */
export function getContainerCommandHandler(name: string): CommandHandler | undefined {
  return commandRegistry.get(name)?.handler;
}
