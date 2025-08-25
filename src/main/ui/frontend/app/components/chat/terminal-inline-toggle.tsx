import React, { useEffect, useMemo, useRef } from 'react';
import { useChatState } from '../../contexts/chat-state-context.js';
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

  return (
    <InlineContainer data-type="assistant">
      <InlineButton
        flashing={hasNew}
        onClick={handleClick}
        aria-label={`Toggle terminal. Last log: ${latestEvent.text}`}
        title={`Toggle terminal. Last log: ${latestEvent.text}`}
      >
        <LevelPill level={latestEvent.level as any}>{latestEvent.level}</LevelPill>
        <Snippet>Container log: {latestEvent.text}</Snippet>
        <Timestamp>{new Date(latestEvent.timestamp).toLocaleTimeString()}</Timestamp>
        {hasNew && <FlashDot aria-hidden="true" />}
      </InlineButton>
    </InlineContainer>
  );
};
