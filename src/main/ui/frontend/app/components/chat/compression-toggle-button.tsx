import React from 'react';
import styled from 'styled-components';
import { useChatState } from '../../contexts/chat-state-context.js';
import { useContextSize, formatContextSizeBadge } from '../../hooks/use-context-size.js';

const CompressionButton = styled.button`
  position: absolute;
  bottom: 160px; /* Positioned above the context manager button (which is at ~90px) */
  right: 30px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 95;
  font-size: 1.5rem;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);

  &:hover {
    transform: scale(1.1);
    background-color: ${({ theme }) => theme.colors.primary};
    color: white;
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  }

  &:active {
    transform: scale(0.95);
  }

  @media (max-width: 768px) {
    bottom: 140px;
    right: 16px;
    width: 42px;
    height: 42px;
    font-size: 1.2rem;
  }
`;

const ContextSizeBadge = styled.div`
  position: absolute;
  top: -8px;
  right: -8px;
  background-color: ${({ theme }) => theme.colors.primary};
  color: white;
  border-radius: 12px;
  min-width: 32px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 24px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  letter-spacing: 0.3px;

  @media (max-width: 768px) {
    font-size: 10px;
    min-width: 28px;
    height: 20px;
    line-height: 20px;
    padding: 0 6px;
  }
`;

export const CompressionToggleButtonWrapper: React.FC = () => {
  const { toggleCompressionModal, messages, executionStatus } = useChatState();
  const { contextSize } = useContextSize(messages);

  if (executionStatus === 'idle') {
    return null;
  }

  return (
    <CompressionButton
      onClick={toggleCompressionModal}
      title={`Compress Context${contextSize ? ` (${formatContextSizeBadge(contextSize)} tokens)` : ''}`}
      aria-label="Open Context Compression Tool"
    >
      📉
      {contextSize !== undefined && contextSize > 0 && (
        <ContextSizeBadge>{formatContextSizeBadge(contextSize)}</ContextSizeBadge>
      )}
    </CompressionButton>
  );
};
