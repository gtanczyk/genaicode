import React from 'react';
import { ChatMessage, ChatMessageType } from '../../../../../common/content-bus-types.js';
import { DataContainer } from './data-container.js';
import {
  SystemMessageContainer as StyledSystemMessageContainer,
  SystemMessageHeader,
  SystemMessageContent,
  SystemMessagePart,
  SystemMessageTimestamp,
  ShowDataLink,
} from './styles/system-message-container-styles.js';

export interface SystemMessageBlock extends Omit<ChatMessage, 'type'> {
  type: ChatMessageType.SYSTEM;
  parts: ChatMessage[];
  isExecutionEnd?: boolean;
}

interface SystemMessageContainerProps {
  message: SystemMessageBlock;
  collapsedExecutions: Set<string>;
  toggleExecutionCollapse: (id: string) => void;
  visibleDataIds: Set<string>;
  toggleDataVisibility: (id: string) => void;
}

export const SystemMessageContainer: React.FC<SystemMessageContainerProps> = ({
  message,
  collapsedExecutions,
  toggleExecutionCollapse,
  visibleDataIds,
  toggleDataVisibility,
}) => {
  return (
    <StyledSystemMessageContainer isExecutionEnd={message.isExecutionEnd}>
      <SystemMessageHeader onClick={() => toggleExecutionCollapse(message.id)}>
        {collapsedExecutions.has(message.id) ? '▶' : '▼'} Execution {message.id.split('_')[1]}
      </SystemMessageHeader>
      {!collapsedExecutions.has(message.id) && (
        <SystemMessageContent>
          {message.parts.map((part) => (
            <SystemMessagePart key={part.id}>
              {part.content}
              <SystemMessageTimestamp>{part.timestamp.toLocaleString()}</SystemMessageTimestamp>
              {part.data ? (
                <ShowDataLink onClick={() => toggleDataVisibility(part.id)}>
                  {visibleDataIds.has(part.id) ? 'Hide data' : 'Show data'}
                </ShowDataLink>
              ) : null}
              {visibleDataIds.has(part.id) && part.data ? <DataContainer data={part.data} /> : null}
            </SystemMessagePart>
          ))}
        </SystemMessageContent>
      )}
    </StyledSystemMessageContainer>
  );
};
