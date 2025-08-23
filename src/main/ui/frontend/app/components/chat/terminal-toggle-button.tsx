import React from 'react';
import { useChatState } from '../../contexts/chat-state-context.js';
import { ToggleButton, TerminalToggleButtonWrapper } from './styles/terminal-toggle-button-styles.js';

export const TerminalToggleButton: React.FC = () => {
  const { isTerminalOpen, toggleTerminal, terminalEvents } = useChatState();

  const hasTerminalEvents = Object.values(terminalEvents).some((events) => events.length > 0);

  if (!hasTerminalEvents) {
    return null;
  }

  return (
    <TerminalToggleButtonWrapper>
      <ToggleButton onClick={toggleTerminal} hasBadge={!isTerminalOpen}>
        {isTerminalOpen ? 'Hide Terminal' : 'Show Terminal'}
      </ToggleButton>
    </TerminalToggleButtonWrapper>
  );
};
