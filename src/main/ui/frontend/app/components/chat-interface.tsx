import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import { MessageContainer } from './chat/message-container.js';
import { SystemMessageContainer, SystemMessageBlock } from './chat/system-message-container.js';
import { ChatContainer, MessagesContainer } from './chat/styles/chat-interface-styles.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages }) => {
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(new Set());
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const mergedMessages = useMemo(() => {
    const result: (ChatMessage | SystemMessageBlock)[] = [];
    let currentSystemBlock: SystemMessageBlock | null = null;
    let executionId = 0;

    messages.forEach((message, index) => {
      if (message.type === 'system') {
        if (currentSystemBlock) {
          currentSystemBlock.parts.push(message);
        } else {
          executionId++;
          currentSystemBlock = {
            ...message,
            type: ChatMessageType.SYSTEM,
            parts: [message],
            id: `execution_${executionId}`,
            isExecutionEnd: index === messages.length - 1 || messages[index + 1].type !== 'system',
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleDataVisibility = (id: string) => {
    setVisibleDataIds((prevIds) => {
      const newIds = new Set(prevIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  };

  const toggleExecutionCollapse = (id: string) => {
    setCollapsedExecutions((prevIds) => {
      const newIds = new Set(prevIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  };

  return (
    <ChatContainer>
      <MessagesContainer>
        {mergedMessages.map((message) => {
          switch (message.type) {
            case 'user':
            case 'assistant':
              return (
                <MessageContainer
                  key={message.id}
                  message={message}
                  visibleDataIds={visibleDataIds}
                  toggleDataVisibility={toggleDataVisibility}
                />
              );
            case 'system':
              return (
                <SystemMessageContainer
                  key={message.id}
                  message={message as SystemMessageBlock}
                  collapsedExecutions={collapsedExecutions}
                  toggleExecutionCollapse={toggleExecutionCollapse}
                  visibleDataIds={visibleDataIds}
                  toggleDataVisibility={toggleDataVisibility}
                />
              );
          }
        })}
        <div ref={messagesEndRef} />
      </MessagesContainer>
    </ChatContainer>
  );
};
