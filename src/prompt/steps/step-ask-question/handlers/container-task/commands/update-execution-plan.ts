import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const updateExecutionPlanDef: FunctionDef = {
  name: 'updateExecutionPlan',
  description: 'Update progress/status against the previously set execution plan.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the step to update.',
      },
      statusUpdate: {
        type: 'string',
        description: 'The updated status of the step.',
      },
      state: {
        type: 'string',
        description: 'The state of the step, e.g., "pending", "in-progress", "completed", "failed", "skipped".',
        enum: ['pending', 'in-progress', 'completed', 'failed', 'skipped'],
      },
    },
    required: ['id', 'statusUpdate', 'state'],
  },
};

type UpdateExecutionPlanArgs = { id: string; statusUpdate: string; state: string };

export async function handleUpdateExecutionPlan(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as UpdateExecutionPlanArgs;
  putContainerLog('info', '📈 Execution plan updated.', args);
  taskExecutionPrompt.push(
    {
      type: 'assistant',
      text: `Updating execution plan for step ${args.id}.`,
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      functionResponses: [{ name: 'updateExecutionPlan', call_id: actionResult.id || undefined }],
    },
  );
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
