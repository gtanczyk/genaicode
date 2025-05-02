import React from 'react';
import styled, { css, keyframes } from 'styled-components';
import { ToggleButton } from '../toggle-button.js';
import { NetworkIcon } from '../icons.js';
import { useChatState } from '../../contexts/chat-state-context.js';

// Define pulsing animation
const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(0, 123, 255, 0.7); // Use theme primary color ideally
  }
  70% {
    transform: scale(1.05);
    box-shadow: 0 0 0 10px rgba(0, 123, 255, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(0, 123, 255, 0);
  }
`;

// Container for the fixed button
const FixedButtonContainer = styled.div`
  position: absolute; // Positioned relative to MainContent
  bottom: 40px;
  right: 30px;
  z-index: 1000; // Ensure it's above other content like scrollbars
`;

// Redefined GraphToggleButton with animation and size increase
const GraphToggleButton = styled(ToggleButton)<{ isActive: boolean }>`
  width: 50px; // Increased size
  height: 50px; // Increased size
  background-color: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.buttonText || '#ffffff'}; // Ensure icon is visible
  border: none;
  animation: ${pulseAnimation} 2s infinite;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);

  &:hover {
    background-color: ${({ theme }) => theme.colors.primaryHover};
    animation-play-state: paused; // Pause animation on hover
  }

  // Style when the visualiser panel is open (isActive prop)
  ${({ isActive, theme }) =>
    isActive &&
    css`
      background-color: ${theme.colors.buttonHoverBg}; // Existing active style
      border: 1px solid ${theme.colors.primary};
      animation: none; // Turn off animation when visualiser is open
    `}
`;

export const GraphToggleButtonWrapper: React.FC = () => {
  // Get graph state and visualiser open state
  const { toggleGraphVisualiser, isGraphVisualiserOpen, conversationGraphState } = useChatState();

  // Only render if the conversation graph is active
  if (!conversationGraphState?.isActive) {
    return null;
  }

  return (
    <FixedButtonContainer>
      <GraphToggleButton
        onClick={toggleGraphVisualiser}
        aria-label="Toggle Conversation Graph"
        title="Toggle Conversation Graph"
        isActive={isGraphVisualiserOpen} // Controls style when visualiser panel is open
      >
        <NetworkIcon />
      </GraphToggleButton>
    </FixedButtonContainer>
  );
};
