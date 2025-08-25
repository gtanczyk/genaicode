import { PromptItem, FunctionCall } from '../../../../../ai-service/common-types.js';
import { ActionHandlerProps } from '../../step-ask-question-types.js';
import Docker from 'dockerode';

export interface CommandHandlerResult {
  success?: boolean;
  summary?: string;
  commandsExecutedIncrement: number;
  shouldBreakOuter: boolean;
}

export interface CommandHandlerBaseProps {
  actionResult: FunctionCall;
  taskExecutionPrompt: PromptItem[];
  container: Docker.Container;
  options: ActionHandlerProps['options'];
}

export interface HandleWrapContextProps extends CommandHandlerBaseProps {
  computeContextMetrics: () => { messageCount: number; estimatedTokens: number };
  maxContextItems: number;
  maxContextSize: number;
}

export interface HandleRunCommandProps extends CommandHandlerBaseProps {
  maxOutputLength: number;
}
