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
  CollapseIcon,
  ExpandIcon,
  IterationContent,
  DeleteButton,
} from './chat/styles/chat-interface-styles.js';
import { useMergedMessages } from '../hooks/merged-messages.js';
import { UnreadMessagesNotification } from './unread-messages-notification.js';
import { QuestionHandler } from './question-handler.js';
import { ProgressIndicator } from './progress-indicator.js';
import { deleteIteration } from '../api/api-client.js';

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
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(() => new Set());
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(() => new Set());
  const [collapsedIterations, setCollapsedIterations] = useState<Set<string>>(() => new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [confirmDeleteIteration, setConfirmDeleteIteration] = useState<string | null>(null);

  const iterations = useMergedMessages(messages);
  const currentIterationId = executionStatus !== 'idle' ? iterations[iterations.length - 1]?.iterationId : null;

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

  useEffect(() => {
    // Collapse all iterations except the latest one
    const newCollapsedIterations = new Set(iterations.slice(0, -1).map((iteration) => iteration.iterationId));
    setCollapsedIterations(newCollapsedIterations);
  }, []);

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

  const toggleIterationCollapse = (id: string) => {
    setCollapsedIterations((prevIds) => {
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

  const handleDeleteIteration = async (iterationId: string) => {
    if (confirmDeleteIteration === iterationId) {
      try {
        await deleteIteration(iterationId);
        setConfirmDeleteIteration(null);
      } catch (error) {
        console.error('Failed to delete iteration:', error);
      }
    } else {
      setConfirmDeleteIteration(iterationId);
    }
  };

  return (
    <ChatContainer>
      <MessagesContainer ref={messagesContainerRef}>
        {iterations.map((iteration, iterationIndex) => (
          <IterationContainer key={iteration.iterationId}>
            <IterationHeader>
              <div className="title" onClick={() => toggleIterationCollapse(iteration.iterationId)}>
                {collapsedIterations.has(iteration.iterationId) ? <ExpandIcon /> : <CollapseIcon />}
                <span>{iteration.iterationTitle ?? `Iteration ${iteration.iterationId}`}</span>
              </div>
              <span className="meta">
                {iteration.timestampStart.toLocaleString()} - {iteration.timestampEnd.toLocaleString()}
                {iteration.iterationId !== currentIterationId && (
                  <DeleteButton
                    onClick={() => handleDeleteIteration(iteration.iterationId)}
                    title={confirmDeleteIteration === iteration.iterationId ? 'Confirm deletion' : 'Delete iteration'}
                  >
                    {confirmDeleteIteration === iteration.iterationId ? '🗑️ Confirm' : '🗑️'}
                  </DeleteButton>
                )}
              </span>
            </IterationHeader>
            <IterationContent isCollapsed={collapsedIterations.has(iteration.iterationId)}>
              {iteration.conversationSummaries.length > 0 && (
                <ConversationSummary>{iteration.conversationSummaries.join(' ')}</ConversationSummary>
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
            </IterationContent>
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
