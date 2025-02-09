import React from 'react';
import styled from 'styled-components';
import { ChatMessage } from '../../../../../common/content-bus-types.js';
import { useContextSize } from '../../hooks/use-context-size.js';

const ContextSizeContainer = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.colors.textSecondary};
  white-space: nowrap;
`;

interface ContextSizeDisplayProps {
  messages: ChatMessage[];
  className?: string;
}

export const ContextSizeDisplay: React.FC<ContextSizeDisplayProps> = ({ messages, className }) => {
  const { formattedSize } = useContextSize(messages);

  return <ContextSizeContainer className={className}>{formattedSize}</ContextSizeContainer>;
};