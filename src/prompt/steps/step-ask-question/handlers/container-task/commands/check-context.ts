import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

export const checkContextDef: FunctionDef = {
  name: 'checkContext',
  description: 'Returns context metrics (message and token counts) and provides guidance on when to wrap context.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export interface CheckContextProps extends CommandHandlerBaseProps {
  computeContextMetrics: () => { messageCount: number; estimatedTokens: number };
  maxContextItems: number;
  maxContextSize: number;
}

export async function handleCheckContext({
  actionResult,
  taskExecutionPrompt,
  computeContextMetrics,
  maxContextItems,
  maxContextSize,
}: CheckContextProps): Promise<CommandHandlerResult> {
  const { messageCount, estimatedTokens } = computeContextMetrics();

  let content = `Context metrics: messages=${messageCount}, tokens≈${estimatedTokens}.`;

  const messageThreshold = maxContextItems * 0.8;
  const tokenThreshold = maxContextSize * 0.8;

  if (messageCount > maxContextItems || estimatedTokens > maxContextSize) {
    content += ` Limits exceeded: messages>${maxContextItems} or tokens>${maxContextSize}. You must call wrapContext now.`;
  } else if (messageCount > messageThreshold || estimatedTokens > tokenThreshold) {
    content += ` Nearing limits. Consider calling wrapContext soon.`;
  }

  taskExecutionPrompt.push(
    {
      type: 'assistant',
      functionCalls: [actionResult],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: actionResult.name,
          call_id: actionResult.id || undefined,
          content,
        },
      ],
    },
  );

  return {
    success: undefined,
    summary: undefined,
    commandsExecutedIncrement: 0,
    shouldBreakOuter: false,
  };
}
