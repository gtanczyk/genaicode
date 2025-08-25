import React, { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useChatState } from '../../contexts/chat-state-context.js';
import { interruptCurrentCommand } from '../../api/api-client.js';
import {
  InlineContainer,
  InlineButton,
  LevelPill,
  Snippet,
  Timestamp,
  FlashDot,
} from './styles/terminal-inline-toggle-styles.js';

interface Props {
  iterationId: string | null;
}

const InterruptButton = styled.button`
  background-color: ${({ theme }) => theme.colors.error || '#dc3545'};
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  font-size: 14px;
  line-height: 24px;
  text-align: center;
  cursor: pointer;
  margin-right: 8px;
  flex-shrink: 0;

  &:hover {
    background-color: ${({ theme }) => theme.colors.errorHover || '#c82333'};
  }
`;

export const TerminalInlineToggle: React.FC<Props> = ({ iterationId }) => {
  const { terminalEvents, isTerminalOpen, toggleTerminal } = useChatState();
  const lastSeenByIteration = useRef<Record<string, string | undefined>>({});

  const events = useMemo(() => {
    if (!iterationId || !terminalEvents[iterationId]) {
      return [];
    }
    return terminalEvents[iterationId];
  }, [iterationId, terminalEvents]);

  const latestEvent = events[events.length - 1];

  useEffect(() => {
    if (isTerminalOpen && iterationId && latestEvent) {
      lastSeenByIteration.current[iterationId] = latestEvent.id;
    }
  }, [isTerminalOpen, iterationId, latestEvent]);

  if (!iterationId || events.length === 0) {
    return null;
  }

  const hasNew = !isTerminalOpen && latestEvent && lastSeenByIteration.current[iterationId] !== latestEvent.id;

  const handleClick = () => {
    toggleTerminal();
    if (iterationId && latestEvent) {
      lastSeenByIteration.current[iterationId] = latestEvent.id;
    }
  };

  const handleInterrupt = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      await interruptCurrentCommand();
    } catch (error) {
      console.error('Failed to interrupt command:', error);
      alert(`Failed to interrupt command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <InlineContainer data-type="assistant">
      <InterruptButton onClick={handleInterrupt} title="Interrupt current command">
        &#9209;
      </InterruptButton>
      <InlineButton
        flashing={hasNew}
        onClick={handleClick}
        aria-label={`Toggle terminal. Last log: ${latestEvent.text}`}
        title={`Toggle terminal. Last log: ${latestEvent.text}`}
      >
        <LevelPill level={latestEvent.level}>{latestEvent.level}</LevelPill>
        <Snippet>Container log: {latestEvent.text}</Snippet>
        <Timestamp>{new Date(latestEvent.timestamp).toLocaleTimeString()}</Timestamp>
        {hasNew && <FlashDot aria-hidden="true" />}
      </InlineButton>
    </InlineContainer>
  );
};
