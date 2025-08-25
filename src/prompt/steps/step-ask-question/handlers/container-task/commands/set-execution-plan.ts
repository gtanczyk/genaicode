import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../types.js';

export const setExecutionPlanDef: FunctionDef = {
  name: 'setExecutionPlan',
  description: 'Record a concise execution plan to follow in subsequent steps.',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'Brief execution plan (high level outline).',
      },
    },
    required: ['plan'],
  },
};

type SetExecutionPlanArgs = { plan: string };

export async function handleSetExecutionPlan(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as SetExecutionPlanArgs | undefined;
  if (!args?.plan) {
    putSystemMessage('⚠️ setExecutionPlan called without plan; ignoring.');
  } else {
    putSystemMessage('📝 Execution plan recorded.', args);

    taskExecutionPrompt.push(
      {
        type: 'assistant',
        text: 'Setting execution plan.',
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [{ name: 'setExecutionPlan', call_id: actionResult.id || undefined }],
      },
    );
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
