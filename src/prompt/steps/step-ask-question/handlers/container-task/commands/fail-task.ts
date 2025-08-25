import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../../main/common/user-actions.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const failTaskDef: FunctionDef = {
  name: 'failTask',
  description: 'Mark the container task as failed.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Explanation of why the task failed.',
      },
    },
    required: ['reason'],
  },
};

type FailTaskArgs = {
  reason: string;
};

export async function handleFailTask(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, options } = props;
  const args = actionResult.args as FailTaskArgs;
  putSystemMessage('❌ Task marked as failed by internal operator.');

  putAssistantMessage(args.reason);

  const confirmation = await askUserForConfirmationWithAnswer(
    'Do you want to finish the failed task?',
    'Finish',
    'Continue',
    true,
    options,
  );

  if (!confirmation.confirmed) {
    putSystemMessage('The user decided not to finish the failed task.');
    if (confirmation.answer) {
      putUserMessage(confirmation.answer);
    }
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        text: 'Failing the task.',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        text: 'Lets not fail the task, and continue working on it. ' + (confirmation.answer ? confirmation.answer : ''),
        functionResponses: [
          {
            name: 'failTask',
            call_id: actionResult.id || undefined,
          },
        ],
      },
    );
    return {
      shouldBreakOuter: false,
      commandsExecutedIncrement: 0,
    };
  }

  putSystemMessage('The user decided to finish the failed task.');

  if (confirmation.answer) {
    putUserMessage(confirmation.answer);
  }

  taskExecutionPrompt.push(
    {
      type: 'assistant',
      text: 'Failing the task.',
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: 'failTask',
          call_id: actionResult.id || undefined,
          content: 'Task marked as failed.',
        },
      ],
    },
  );
  return {
    shouldBreakOuter: true,
    success: false,
    summary: args.reason,
    commandsExecutedIncrement: 0,
  };
}
