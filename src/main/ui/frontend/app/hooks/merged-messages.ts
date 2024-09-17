import { useMemo } from 'react';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

export interface SystemMessageBlock extends ChatMessage {
  parts: ChatMessage[];
  isExecutionEnd: boolean;
}

export function useMergedMessages(messages: ChatMessage[]): (ChatMessage | SystemMessageBlock)[] {
  return useMemo(() => {
    const result: (ChatMessage | SystemMessageBlock)[] = [];
    let currentSystemBlock: SystemMessageBlock | null = null;
    let executionId = 0;

    messages.forEach((message, index) => {
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
          result.push(currentSystemBlock);
        }
      } else {
        if (currentSystemBlock) {
          currentSystemBlock.isExecutionEnd = true;
        }
        currentSystemBlock = null;
        result.push(message);
      }
    });

    return result;
  }, [messages]);
}
