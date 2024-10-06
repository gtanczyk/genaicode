import { useMemo } from 'react';
import { ChatMessage, ChatMessageType, ChatMessageFlags } from '../../../../common/content-bus-types.js';

export interface SystemMessageBlock extends ChatMessage {
  parts: ChatMessage[];
  isExecutionEnd: boolean;
}

export interface IterationGroup {
  iterationId: string;
  timestampStart: Date;
  timestampEnd: Date;
  conversationSummaries: string[];
  messages: (ChatMessage | SystemMessageBlock)[];
}

export function useMergedMessages(messages: ChatMessage[]): IterationGroup[] {
  return useMemo(() => {
    const iterations: IterationGroup[] = [];
    let currentIteration: IterationGroup | null = null;
    let currentSystemBlock: SystemMessageBlock | null = null;
    let executionId = 0;

    messages
      .sort((a, b) => (a.iterationId < b.iterationId ? -1 : 1))
      .forEach((message, index) => {
        if (!currentIteration || message.iterationId !== currentIteration.iterationId) {
          if (currentIteration) {
            currentIteration.timestampEnd = new Date(message.timestamp);
            iterations.push(currentIteration);
          }
          currentIteration = {
            iterationId: message.iterationId,
            timestampStart: new Date(message.timestamp),
            timestampEnd: new Date(message.timestamp), // Will be updated when the next iteration starts or at the end
            conversationSummaries: [],
            messages: [],
          };
        }

        if (message.flags?.includes(ChatMessageFlags.CONVERSATION_SUMMARY) && message.data) {
          currentIteration.conversationSummaries.push(message.data as string);
        }

        if (message.type === ChatMessageType.SYSTEM) {
          if (currentSystemBlock) {
            currentSystemBlock.parts.push(message);
          } else {
            executionId++;
            currentSystemBlock = {
              ...message,
              type: ChatMessageType.SYSTEM,
              parts: [message],
              id: `execution_${executionId}`,
              isExecutionEnd: index === messages.length - 1 || messages[index + 1].type !== ChatMessageType.SYSTEM,
            };
            currentIteration.messages.push(currentSystemBlock);
          }
        } else {
          if (currentSystemBlock) {
            currentSystemBlock.isExecutionEnd = true;
          }
          currentSystemBlock = null;
          currentIteration.messages.push(message);
        }

        // Update the end timestamp for the current iteration
        currentIteration.timestampEnd = new Date(message.timestamp);
      });

    // Add the last iteration if it exists
    if (currentIteration) {
      iterations.push(currentIteration);
    }

    // Sort iterations by timestampStart
    return iterations.sort((a, b) => a.timestampStart.getTime() - b.timestampStart.getTime());
  }, [messages]);
}
