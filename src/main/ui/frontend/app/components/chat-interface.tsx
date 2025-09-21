import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  InlineTogglesContainer,
} from './chat/styles/chat-interface-styles.js';
import { useMergedMessages } from '../hooks/merged-messages.js';
import { ContextSizeDisplay } from './chat/context-size-display.js';
import { UnreadMessagesNotification } from './unread-messages-notification.js';
import { QuestionHandler } from './question-handler.js';
import { ProgressIndicator } from './progress-indicator.js';
import { deleteIteration } from '../api/api-client.js';
import { Question } from '../../../common/api-types.js';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import { TerminalInlineToggle } from './chat/terminal-inline-toggle.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  currentQuestion: Question | null;
  codegenOptions: CodegenOptions;
  onQuestionSubmit: (
    answer: string,
    images?: File[],
    confirmed?: boolean,
    aiService?: AiServiceType,
    selectedActionType?: string,
  ) => void;
  onInterrupt: () => void;
  onPauseResume: () => void;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  currentQuestion,
  codegenOptions,
  onQuestionSubmit,
  onInterrupt,
  onPauseResume,
  executionStatus,
}) => {
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(() => new Set());
  const [collapsedExecutions, setCollapsedExecutions] = useState<Set<string>>(() => new Set());
  const [collapsedIterations, setCollapsedIterations] = useState<Set<string>>(() => new Set());
  const [editingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [confirmDeleteIteration, setConfirmDeleteIteration] = useState<string | null>(null);

  const iterations = useMergedMessages(messages);
  const currentIterationId = executionStatus !== 'idle' ? iterations[iterations.length - 1]?.iterationId : null;

  const isAtBottom = useCallback(() => {
    if (!messagesContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    // Increased tolerance for scroll comparison
    return Math.abs(scrollHeight - clientHeight - scrollTop) < 5 || scrollHeight <= clientHeight;
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const atBottom = isAtBottom();
      setIsScrolledToBottom(atBottom);
      if (atBottom) {
        setHasUnreadMessages(false);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isAtBottom]);

  useEffect(() => {
    if (isScrolledToBottom) {
      scrollToBottom();
    } else {
      // Only set unread if the update wasn't triggered by this user scrolling up
      if (messages.length > 0) {
        // Check if there are messages
        setHasUnreadMessages(true);
      }
    }
  }, [iterations, isScrolledToBottom, messages.length]);

  useEffect(() => {
    // Collapse all iterations except the latest one initially
    const initialCollapsed = new Set(iterations.slice(0, -1).map((iteration) => iteration.iterationId));
    setCollapsedIterations(initialCollapsed);
  }, [iterations.length]); // Only run when the number of iterations changes

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

  const toggleIterationCollapse = (iterationId: string) => {
    // Don't allow collapsing if a message is being edited in this iteration
    if (editingMessageId && messages.find((m) => m.id === editingMessageId)?.iterationId === iterationId) {
      return;
    }

    setCollapsedIterations((prevIds) => {
      const newIds = new Set(prevIds);
      if (newIds.has(iterationId)) {
        newIds.delete(iterationId);
      } else {
        newIds.add(iterationId);
      }
      return newIds;
    });
  };

  const scrollToBottom = () => {
    // Use requestAnimationFrame to ensure scroll happens after render
    requestAnimationFrame(() => {
      messagesContainerRef.current?.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
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
                <ContextSizeDisplay messages={iteration.messages} />
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
                  {/* Render QuestionHandler below the last message of the current iteration if needed */}
                  {executionStatus !== 'idle' &&
                    currentQuestion &&
                    iterationIndex === iterations.length - 1 &&
                    messageIndex === iteration.messages.length - 1 && (
                      <QuestionHandler
                        onSubmit={onQuestionSubmit}
                        onInterrupt={onInterrupt}
                        onPauseResume={onPauseResume}
                        question={currentQuestion}
                        codegenOptions={codegenOptions}
                        executionStatus={executionStatus}
                        // Removed suggestions prop
                      />
                    )}
                </React.Fragment>
              ))}
              {iterationIndex === iterations.length - 1 && (
                <InlineTogglesContainer>
                  <TerminalInlineToggle iterationId={currentIterationId} />
                </InlineTogglesContainer>
              )}
            </IterationContent>
          </IterationContainer>
        ))}
        {/* Render QuestionHandler outside the loop if there's a question but no messages yet or after the last message */}
        {executionStatus !== 'idle' &&
          currentQuestion &&
          iterations.length > 0 &&
          iterations[iterations.length - 1].messages.length === 0 && (
            <QuestionHandler
              onSubmit={onQuestionSubmit}
              onInterrupt={onInterrupt}
              onPauseResume={onPauseResume}
              question={currentQuestion}
              codegenOptions={codegenOptions}
              executionStatus={executionStatus}
            />
          )}
        <div ref={messagesEndRef} />
      </MessagesContainer>

      {hasUnreadMessages && !isScrolledToBottom && <UnreadMessagesNotification onClick={scrollToBottom} />}
      <ProgressIndicator
        isVisible={executionStatus !== 'idle' && !currentQuestion}
        onInterrupt={onInterrupt}
        onPauseResume={onPauseResume}
        executionStatus={executionStatus}
      />
    </ChatContainer>
  );
};
