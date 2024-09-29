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
      <InterruptButton onClick={onInterrupt}>Interrupt</InterruptButton>
      <ProgressDots data-execution-status={executionStatus}>
        <ProgressDot />
        <ProgressDot />
        <ProgressDot />
      </ProgressDots>
      <ActionButton onClick={onPauseResume}>{executionStatus === 'paused' ? 'Resume' : 'Pause'}</ActionButton>
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
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 50px;
  padding: 10px;
  background-color: ${(props) => props.theme.colors.background};
  border-top: 1px solid ${(props) => props.theme.colors.border};
`;

const ProgressDots = styled.div`
  display: flex;
  align-items: center;
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

const ActionButton = styled.button`
  padding: 8px 16px;
  background-color: ${(props) => props.theme.colors.primary};
  color: #ffffff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.3s, transform 0.1s;

  &:hover {
    background-color: ${(props) => props.theme.colors.primaryHover};
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const InterruptButton = styled(ActionButton)`
  background-color: ${({ theme }) => theme.colors.error};

  &:hover {
    background-color: ${({ theme }) => theme.colors.errorHover};
  }
`;