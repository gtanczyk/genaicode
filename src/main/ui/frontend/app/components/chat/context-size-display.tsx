import React from 'react';
import styled from 'styled-components';
import { ChatMessage } from '../../../../../common/content-bus-types.js';
import { useContextSize, formatContextSize } from '../../hooks/use-context-size.js';

const ContextSizeContainer = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.colors.textSecondary};
  white-space: nowrap;
`;

interface ContextSizeDisplayProps {
  messages?: ChatMessage[];
  className?: string;
}

export const ContextSizeDisplay: React.FC<ContextSizeDisplayProps> = ({ messages, className }) => {
  if (!messages || messages.length === 0) {
    return null;
  }

  const { formattedSize, totalTokens } = useContextSize(messages);

  // Prefer backend-derived totalTokens if available; otherwise use message-based formatted size
  const displayText = typeof totalTokens === 'number' ? formatContextSize(totalTokens) : formattedSize;

  return <ContextSizeContainer className={className}>{displayText}</ContextSizeContainer>;
};
