import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import { MessageContainer } from './chat/message-container.js';
import { SystemMessageContainer, SystemMessageBlock } from './chat/system-message-container.js';
import { ChatContainer, MessagesContainer } from './chat/styles/chat-interface-styles.js';
import { useMergedMessages } from '../hooks/merged-messages.js';
import { UnreadMessagesNotification } from './unread-messages-notification.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages }) => {
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(new Set());
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  const mergedMessages = useMergedMessages(messages);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px threshold
      setIsScrolledToBottom(isAtBottom);
      if (isAtBottom) {
        setHasUnreadMessages(false);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isScrolledToBottom) {
      scrollToBottom();
    } else {
      setHasUnreadMessages(true);
    }
  }, [messages, isScrolledToBottom]);

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

  const scrollToBottom = () => {
    messagesContainerRef.current?.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior: 'smooth'
    });
    setHasUnreadMessages(false);
  };

  return (
    <ChatContainer>
      <MessagesContainer ref={messagesContainerRef}>
        {mergedMessages.map((message) => {
          switch (message.type) {
            case ChatMessageType.USER:
            case ChatMessageType.ASSISTANT:
              return (
                <MessageContainer
                  key={message.id}
                  message={message}
                  visibleDataIds={visibleDataIds}
                  toggleDataVisibility={toggleDataVisibility}
                />
              );
            case ChatMessageType.SYSTEM:
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
      {hasUnreadMessages && <UnreadMessagesNotification onClick={scrollToBottom} />}
    </ChatContainer>
  );
};