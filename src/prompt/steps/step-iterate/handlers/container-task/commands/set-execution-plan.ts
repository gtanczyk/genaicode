import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { updateExecutionPlanDef } from './update-execution-plan.js';

export const setExecutionPlanDef: FunctionDef = {
  name: 'setExecutionPlan',
  description: 'Record a concise execution plan to follow in subsequent steps.',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        description:
          'The steps of the execution plan. This is the latest most up to date version of the plan, which takes into account all prior context and findings.',
        items: {
          type: 'object',
          description: 'A single step in the execution plan.',
          properties: {
            id: {
              type: 'string',
              description: 'A unique identifier for this step.',
            },
            description: {
              type: 'string',
              description: 'A brief description of this step.',
            },
            dependsOn: {
              type: 'array',
              description: 'The IDs of the steps that this step depends on.',
              items: {
                type: 'string',
              },
            },
            state: updateExecutionPlanDef.parameters.properties.state,
            statusUpdate: updateExecutionPlanDef.parameters.properties.statusUpdate,
          },
          required: ['id', 'description', 'dependsOn'],
        },
      },
    },
    required: ['plan'],
  },
};

type SetExecutionPlanArgs = { plan: Array<{ id: string; description: string; dependsOn: string[] }> };

export async function handleSetExecutionPlan(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as SetExecutionPlanArgs | undefined;
  putContainerLog('info', '📝 Execution plan recorded.', args);

  taskExecutionPrompt.push(
    {
      type: 'assistant',
      text: 'Setting execution plan.',
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      text: 'Please follow the execution plan carefully.',
      functionResponses: [{ name: actionResult.name, call_id: actionResult.id || undefined }],
    },
  );
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
