import { FunctionDef, FunctionCall, PromptItem } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../../main/common/user-actions.js';
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
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as CompleteTaskArgs;
  putSystemMessage('✅ Task marked as complete by internal operator.');
  putAssistantMessage(args.summary);
  const confirmation = await askUserForConfirmationWithAnswer(
    'Are you sure you want to complete the task?',
    'Yes',
    'No',
    true,
    props.options,
  );
  if (confirmation.answer) {
    putUserMessage(confirmation.answer);
  }

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
          content: confirmation.confirmed
            ? 'Task completed successfully.'
            : 'Task is incomplete. Please continue.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        },
      ],
    },
  );

  return {
    shouldBreakOuter: confirmation.confirmed === true,
    success: true,
    summary: args.summary,
    commandsExecutedIncrement: 0,
  };
}
