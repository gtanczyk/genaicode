import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { FailTaskArgs } from '../container-task-types.js';
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

export async function handleFailTask(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as FailTaskArgs;
  putSystemMessage('❌ Task marked as failed by internal operator.');

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
