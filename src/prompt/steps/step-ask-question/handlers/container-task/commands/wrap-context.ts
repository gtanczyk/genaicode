import { FunctionDef, PromptItem } from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';
import { setExecutionPlanDef } from './set-execution-plan.js';

export const wrapContextDef: FunctionDef = {
  name: 'wrapContext',
  description: `Used to reduce context size by summarizing prior steps and important findings.
It contains the latest information about the task and its context, which can be used for future actions.
It should not be executed when we are in the middle of a critical task.
  `,
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A summary of prior steps and important findings to keep for next actions.',
      },
      plan: setExecutionPlanDef.parameters.properties.plan,
      progress: {
        type: 'string',
        description: 'What was achieved so far? What are the outcomes?',
      },
      importantFiles: {
        type: 'array',
        items: {
          type: 'string',
          description: `Paths to important files or directories to keep in mind for next actions.
It is critically IMPORTANT to keep track of files which are essential for the task. For example the files that were modified or created during the task so far.`,
        },
      },
      nextStep: {
        type: 'string',
        description: 'The next step to take in the process.',
      },
    },
    required: ['summary', 'plan', 'progress', 'importantFiles', 'nextStep'],
  },
};

export interface HandleWrapContextProps extends CommandHandlerBaseProps {}

type WrapContextArgs = { summary: string; nextStep: string };

export async function handleWrapContext(props: HandleWrapContextProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as WrapContextArgs;
  putContainerLog('info', '🗂️ Context wrapped by internal operator.', args);

  const assistantMsg: PromptItem = {
    type: 'assistant',
    text: 'Wrapping context for continued processing. This summary will help maintain continuity, it contains the current plan, list of important files, and progress made so far, as well as the next step to take.',
    functionCalls: [actionResult],
  };
  const userResp: PromptItem = {
    type: 'user',
    text: `Please continue with the next step: ${args.nextStep}`,
    functionResponses: [
      {
        name: 'wrapContext',
        call_id: actionResult.id || undefined,
      },
    ],
  };

  taskExecutionPrompt.splice(0, taskExecutionPrompt.length);
  taskExecutionPrompt.push(assistantMsg, userResp);

  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
