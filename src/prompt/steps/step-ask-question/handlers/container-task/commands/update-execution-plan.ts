import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const updateExecutionPlanDef: FunctionDef = {
  name: 'updateExecutionPlan',
  description: 'Update progress/status against the previously set execution plan.',
  parameters: {
    type: 'object',
    properties: {
      progress: {
        type: 'string',
        description: 'Progress update and next steps if applicable.',
      },
    },
    required: ['progress'],
  },
};

type UpdateExecutionPlanArgs = { progress: string };

export async function handleUpdateExecutionPlan(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as UpdateExecutionPlanArgs | undefined;
  if (!args?.progress) {
    putSystemMessage('⚠️ updateExecutionPlan called without progress; ignoring.');
  } else {
    putSystemMessage('📈 Execution plan updated.', args);

    taskExecutionPrompt.push(
      {
        type: 'assistant',
        text: 'Updating execution plan.',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [{ name: 'updateExecutionPlan', call_id: actionResult.id || undefined }],
      },
    );
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
