import React from 'react';
import styled, { keyframes } from 'styled-components';

interface ProgressIndicatorProps {
  isVisible: boolean;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <ProgressContainer>
      <ProgressDot />
      <ProgressDot />
      <ProgressDot />
    </ProgressContainer>
  );
};

const pulse = keyframes`
  0%, 80%, 100% { 
    transform: scale(0);
  }
  40% { 
    transform: scale(1.0);
  }
`;

const ProgressContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px;
`;

const ProgressDot = styled.div`
  width: 10px;
  height: 10px;
  background-color: ${props => props.theme.colors.primary};
  border-radius: 50%;
  margin: 0 5px;
  animation: ${pulse} 1.4s infinite ease-in-out both;

  &:nth-child(1) {
    animation-delay: -0.32s;
  }

  &:nth-child(2) {
    animation-delay: -0.16s;
  }
`;