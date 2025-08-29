import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExecutionPlan, ExecutionPlanUpdate, TerminalEvent } from '../../../../common/api-types.js';
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
  TabsContainer,
  TabButton,
} from './styles/terminal-view-styles.js';
import { ExecutionPlanPanel } from './execution-plan-visualiser.js';

const MAX_LOG_LINES = 5000;
const SCROLL_THRESHOLD = 16; // Pixels from the bottom to be considered "at the bottom"

interface TerminalViewProps {
  events: TerminalEvent[];
  onClear: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ events, onClear }) => {
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const [showAllPayloads, setShowAllPayloads] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set<string>());
  const [activeTab, setActiveTab] = useState<'logs' | 'plan'>('logs');
  const { toggleTerminal } = useChatState();
  const isScrolledToBottomRef = useRef(true);

  const { executionPlan, planUpdates } = useMemo(() => {
    const planEvent = [...events].reverse().find((event) => event.data?.plan);
    const plan = planEvent?.data?.plan as ExecutionPlan | undefined;
    const updates = events
      .filter((event) => event.data?.statusUpdate && event.data?.id && event.data?.state)
      .map((event) => event.data as ExecutionPlanUpdate);
    return { executionPlan: plan, planUpdates: updates };
  }, [events]);

  useLayoutEffect(() => {
    if (terminalBodyRef.current && activeTab === 'logs' && isScrolledToBottomRef.current) {
      setTimeout(() => {
        if (terminalBodyRef.current) {
          terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [events, activeTab]);

  const handleInterrupt = async () => {
    try {
      await interruptCurrentCommand();
    } catch (error) {
      console.error('Failed to interrupt command:', error);
    }
  };

  const displayedEvents = events.length > MAX_LOG_LINES ? events.slice(-MAX_LOG_LINES) : events;

  const handleScroll = () => {
    if (terminalBodyRef.current) {
      isScrolledToBottomRef.current =
        terminalBodyRef.current.scrollHeight - terminalBodyRef.current.scrollTop <=
        terminalBodyRef.current.clientHeight + SCROLL_THRESHOLD;
    }
  };

  return (
    <TerminalContainer>
      <TerminalHeader>
        <h4>Container Task</h4>
        <TabsContainer>
          <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')}>
            Logs
          </TabButton>
          <TabButton active={activeTab === 'plan'} onClick={() => setActiveTab('plan')} disabled={!executionPlan}>
            Execution Plan
          </TabButton>
        </TabsContainer>
        <ControlBar>
          {activeTab === 'logs' && (
            <>
              <ToggleButton active={false} onClick={onClear} aria-label="Clear terminal log">
                Clear
              </ToggleButton>
              <ToggleButton
                active={showAllPayloads}
                onClick={() => setShowAllPayloads(!showAllPayloads)}
                aria-label={showAllPayloads ? 'Hide all payloads' : 'Show all payloads'}
              >
                Payloads
              </ToggleButton>
            </>
          )}
          <ToggleButton active={false} onClick={handleInterrupt} aria-label="Interrupt current container command">
            Interrupt
          </ToggleButton>
          <CloseButton onClick={toggleTerminal} aria-label="Close terminal">
            &times;
          </CloseButton>
        </ControlBar>
      </TerminalHeader>
      <TerminalBody ref={terminalBodyRef} onScroll={handleScroll}>
        {activeTab === 'logs' ? (
          displayedEvents.map((event) => {
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
                      <PayloadToggle
                        onClick={() => {
                          const newSet = new Set(expandedIds);
                          if (isExpanded) {
                            newSet.delete(event.id);
                          } else {
                            newSet.add(event.id);
                          }
                          setExpandedIds(newSet);
                        }}
                      >
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
          })
        ) : (
          <ExecutionPlanPanel executionPlan={executionPlan} planUpdates={planUpdates} />
        )}
      </TerminalBody>
    </TerminalContainer>
  );
};
