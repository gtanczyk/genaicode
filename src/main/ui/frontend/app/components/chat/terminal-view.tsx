import React, { useEffect, useRef, useState } from 'react';
import { TerminalEvent } from '../../../../common/api-types.js';
import { useChatState } from '../../contexts/chat-state-context.js';
import { interruptCurrentCommand } from '../../api/api-client.js';
import {
  TerminalContainer,
  TerminalHeader,
  TerminalBody,
  LogLine,
  LevelBadge,
  ControlBar,
  ToggleButton,
  PayloadToggle,
  PayloadContainer,
  PayloadPre,
  MessageCell,
  CloseButton,
} from './styles/terminal-view-styles.js';

const MAX_LOG_LINES = 5000;

interface TerminalViewProps {
  events: TerminalEvent[];
  onClear: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ events, onClear, autoScroll, onToggleAutoScroll }) => {
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const [showAllPayloads, setShowAllPayloads] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set<string>());
  const { toggleTerminal } = useChatState();

  useEffect(() => {
    if (autoScroll && terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleInterrupt = async () => {
    try {
      await interruptCurrentCommand();
    } catch (error) {
      console.error('Failed to interrupt command:', error);
    }
  };

  const displayedEvents = events.length > MAX_LOG_LINES ? events.slice(-MAX_LOG_LINES) : events;

  return (
    <TerminalContainer>
      <TerminalHeader>
        <h4>Container Task Log</h4>
        <ControlBar>
          <ToggleButton active={false} onClick={handleInterrupt} aria-label="Interrupt current container command">
            Interrupt command
          </ToggleButton>
          <ToggleButton active={false} onClick={onClear} aria-label="Clear terminal log">
            Clear
          </ToggleButton>
          <ToggleButton
            active={showAllPayloads}
            onClick={() => setShowAllPayloads(!showAllPayloads)}
            aria-label={showAllPayloads ? 'Hide all payloads' : 'Show all payloads'}
          >
            Show Payloads
          </ToggleButton>
          <ToggleButton
            active={autoScroll}
            onClick={onToggleAutoScroll}
            aria-label={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            Auto-scroll
          </ToggleButton>
          <CloseButton onClick={toggleTerminal} aria-label="Close terminal">
            &times;
          </CloseButton>
        </ControlBar>
      </TerminalHeader>
      <TerminalBody ref={terminalBodyRef}>
        {displayedEvents.map((event) => {
          const hasPayload = !!(event.data && Object.keys(event.data).length > 0);
          const isExpanded = showAllPayloads || expandedIds.has(event.id);

          let prettyPayload = '';
          if (hasPayload) {
            try {
              prettyPayload = JSON.stringify(event.data, null, 2);
            } catch (e) {
              prettyPayload = String(event.data);
            }
          }

          return (
            <React.Fragment key={event.id}>
              <LogLine>
                <span className="timestamp">{new Date(event.timestamp).toLocaleTimeString()}</span>
                <LevelBadge level={event.level}>{event.level}</LevelBadge>
                <span className="source">[{event.source}]</span>
                <MessageCell>
                  {event.text}
                  {hasPayload && (
                    <PayloadToggle onClick={() => toggleExpanded(event.id)}>
                      {isExpanded ? 'Hide payload' : 'Show payload'}
                    </PayloadToggle>
                  )}
                </MessageCell>
              </LogLine>
              {hasPayload && isExpanded && (
                <PayloadContainer>
                  <PayloadPre>{prettyPayload}</PayloadPre>
                </PayloadContainer>
              )}
            </React.Fragment>
          );
        })}
      </TerminalBody>
    </TerminalContainer>
  );
};
