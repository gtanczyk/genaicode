import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import { MessageContainer } from './chat/message-container.js';
import { SystemMessageContainer, SystemMessageBlock } from './chat/system-message-container.js';
import {
  ChatContainer,
  MessagesContainer,
  IterationContainer,
  IterationHeader,
  ConversationSummary,
} from './chat/styles/chat-interface-styles.js';
import { useMergedMessages } from '../hooks/merged-messages.js';
import { UnreadMessagesNotification } from './unread-messages-notification.js';
import { QuestionHandler } from './question-handler.js';
import { ProgressIndicator } from './progress-indicator.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  currentQuestion: { id: string; text: string; isConfirmation: boolean } | null;
  onQuestionSubmit: (answer: string) => void;
  onInterrupt: () => void;
  onPauseResume: () => void;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  currentQuestion,
  onQuestionSubmit,
  onInterrupt,
  onPauseResume,
  executionStatus,
}) => {
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(new Set());
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  const iterations = useMergedMessages(messages);

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
  }, [iterations, isScrolledToBottom]);

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
      behavior: 'smooth',
    });
    setHasUnreadMessages(false);
  };

  return (
    <ChatContainer>
      <MessagesContainer ref={messagesContainerRef}>
        {iterations.map((iteration, iterationIndex) => (
          <IterationContainer key={iteration.iterationId}>
            <IterationHeader>
              Iteration {iteration.iterationId}
              <span>
                {iteration.timestampStart.toLocaleString()} - {iteration.timestampEnd.toLocaleString()}
              </span>
            </IterationHeader>
            {iteration.conversationSummaries.length > 0 && (
              <ConversationSummary>
                {iteration.conversationSummaries.map((summary) => (
                  <>
                    {summary}
                    <br />
                  </>
                ))}
              </ConversationSummary>
            )}
            {iteration.messages.map((message, messageIndex) => (
              <React.Fragment key={message.id}>
                {message.type === ChatMessageType.SYSTEM ? (
                  <SystemMessageContainer
                    message={message as SystemMessageBlock}
                    collapsedExecutions={collapsedExecutions}
                    toggleExecutionCollapse={toggleExecutionCollapse}
                    visibleDataIds={visibleDataIds}
                    toggleDataVisibility={toggleDataVisibility}
                  />
                ) : (
                  <MessageContainer
                    message={message}
                    visibleDataIds={visibleDataIds}
                    toggleDataVisibility={toggleDataVisibility}
                  />
                )}
                {executionStatus !== 'idle' &&
                  currentQuestion &&
                  iterationIndex === iterations.length - 1 &&
                  messageIndex === iteration.messages.length - 1 && (
                    <QuestionHandler
                      onSubmit={onQuestionSubmit}
                      onInterrupt={onInterrupt}
                      onPauseResume={onPauseResume}
                      question={currentQuestion}
                      executionStatus={executionStatus}
                    />
                  )}
              </React.Fragment>
            ))}
          </IterationContainer>
        ))}
        <div ref={messagesEndRef} />
      </MessagesContainer>
      {hasUnreadMessages && <UnreadMessagesNotification onClick={scrollToBottom} />}
      <ProgressIndicator
        isVisible={executionStatus !== 'idle' && !currentQuestion}
        onInterrupt={onInterrupt}
        onPauseResume={onPauseResume}
        executionStatus={executionStatus}
      />
    </ChatContainer>
  );
};
