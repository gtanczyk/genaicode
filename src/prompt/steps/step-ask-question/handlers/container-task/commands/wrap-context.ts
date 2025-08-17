import { FunctionDef, PromptItem } from '../../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const wrapContextDef: FunctionDef = {
  name: 'wrapContext',
  description: 'Replace prior conversation in the loop with a concise summary for continued processing.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A summary of prior steps and important findings to keep for next actions.',
      },
      plan: {
        type: 'string',
        description: 'A concise plan outlining the plan of action for the task.',
      },
      progress: {
        type: 'string',
        description: 'What was achieved so far? What are the outcomes?',
      },
      importantFiles: {
        type: 'array',
        items: {
          type: 'string',
          description: `Paths to important files to keep for next actions.
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

export interface HandleWrapContextProps extends CommandHandlerBaseProps {
  computeContextMetrics: () => { messageCount: number; estimatedTokens: number };
  maxContextItems: number;
  maxContextSize: number;
}

type WrapContextArgs = { summary: string };

export async function handleWrapContext(props: HandleWrapContextProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, computeContextMetrics, maxContextItems, maxContextSize } = props;
  const args = actionResult.args as WrapContextArgs | undefined;
  if (!args?.summary) {
    putSystemMessage('⚠️ wrapContext called without summary; ignoring.');
  } else {
    putSystemMessage('🗂️ Context wrapped by internal operator.', args);

    const assistantMsg: PromptItem = {
      type: 'assistant',
      text: 'Wrapping context for continued processing.',
      functionCalls: [actionResult],
    };
    const userResp: PromptItem = {
      type: 'user',
      text: 'Please continue ',
      functionResponses: [
        {
          name: 'wrapContext',
          call_id: actionResult.id || undefined,
        },
      ],
    };

    const previousWraps = taskExecutionPrompt.filter(
      (item) =>
        item.functionCalls?.some((call) => call.name === 'wrapContext') ||
        item.functionResponses?.some((resp) => resp.name === 'wrapContext'),
    );
    for (const wrap of previousWraps) {
      delete wrap.text;
      wrap.functionCalls = wrap.functionCalls?.filter((call) => call.name === 'wrapContext');
      wrap.functionResponses = wrap.functionResponses?.filter((resp) => resp.name === 'wrapContext');
    }

    taskExecutionPrompt.splice(0, taskExecutionPrompt.length);
    taskExecutionPrompt.push(...previousWraps, assistantMsg, userResp);

    const { messageCount, estimatedTokens } = computeContextMetrics();
    if (messageCount < maxContextItems && estimatedTokens < maxContextSize) {
      userResp.text = `The context is within limits: ${messageCount} messages, ${estimatedTokens} tokens is less than the maximum allowed: ${maxContextItems} messages, ${maxContextSize} tokens.`;
    }
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
