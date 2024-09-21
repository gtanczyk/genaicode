import React from 'react';
import styled, { keyframes } from 'styled-components';

interface ProgressIndicatorProps {
  isVisible: boolean;
  onInterrupt: () => void;
  onPauseResume: () => void;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  isVisible,
  onInterrupt,
  onPauseResume,
  executionStatus,
}) => {
  if (!isVisible) return null;

  return (
    <ProgressContainer>
      <ProgressDots data-execution-status={executionStatus}>
        <ProgressDot />
        <ProgressDot />
        <ProgressDot />
      </ProgressDots>
      <ButtonContainer>
        <ActionButton onClick={onInterrupt}>Interrupt</ActionButton>
        <ActionButton onClick={onPauseResume}>{executionStatus === 'paused' ? 'Resume' : 'Pause'}</ActionButton>
      </ButtonContainer>
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
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 10px;
  background-color: ${(props) => props.theme.colors.background};
  border-top: 1px solid ${(props) => props.theme.colors.border};
`;

const ProgressDots = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
`;

const ProgressDot = styled.div`
  width: 10px;
  height: 10px;
  background-color: ${(props) => props.theme.colors.primary};
  border-radius: 50%;
  margin: 0 5px;

  [data-execution-status='executing'] & {
    animation: ${pulse} 1.4s infinite ease-in-out both;
  }

  &:nth-child(1) {
    animation-delay: -0.32s;
  }

  &:nth-child(2) {
    animation-delay: -0.16s;
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  width: 25%;
  justify-content: space-between;
`;

const ActionButton = styled.button`
  padding: 5px 10px;
  background-color: ${(props) => props.theme.colors.primary};
  color: ${(props) => props.theme.colors.text};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${(props) => props.theme.colors.primaryHover};
  }
`;
