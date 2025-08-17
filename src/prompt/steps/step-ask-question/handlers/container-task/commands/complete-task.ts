import { FunctionDef, FunctionCall, PromptItem } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { ActionHandlerProps } from '../../../step-ask-question-types.js';
import Docker from 'dockerode';

// Types from the old container-command-handlers.ts that will be shared by other commands
export interface CommandHandlerResult {
  shouldBreakOuter: boolean;
  success?: boolean;
  summary?: string;
  commandsExecutedIncrement: number;
}

export interface CommandHandlerBaseProps {
  actionResult: FunctionCall;
  taskExecutionPrompt: PromptItem[];
  options: ActionHandlerProps['options'];
  container: Docker.Container;
}

type CompleteTaskArgs = {
  summary: string;
};

export const completeTaskDef: FunctionDef = {
  name: 'completeTask',
  description: 'Mark the container task as successfully completed.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of what was accomplished.',
      },
    },
    required: ['summary'],
  },
};

export async function handleCompleteTask(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as CompleteTaskArgs;
  putSystemMessage('✅ Task marked as complete by internal operator.');

  taskExecutionPrompt.push(
    {
      type: 'assistant',
      text: 'Completing the task.',
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: 'completeTask',
          call_id: actionResult.id || undefined,
          content: 'Task completed successfully.',
        },
      ],
    },
  );

  return {
    shouldBreakOuter: true,
    success: true,
    summary: args.summary,
    commandsExecutedIncrement: 0,
  };
}
