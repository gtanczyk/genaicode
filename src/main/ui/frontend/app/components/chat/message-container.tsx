import React from 'react';
import { ChatMessage } from '../../../../../common/content-bus-types.js';
import { DataContainer } from './data-container.js';
import {
  MessageContainer as StyledMessageContainer,
  MessageBubble,
  MessageHeader,
  MessageContent,
  MessageFooter,
  MessageTimestamp,
  ShowDataLink,
} from './styles/message-container-styles.js';

interface MessageContainerProps {
  message: ChatMessage;
  visibleDataIds: Set<string>;
  toggleDataVisibility: (id: string) => void;
}

export const MessageContainer: React.FC<MessageContainerProps> = ({
  message,
  visibleDataIds,
  toggleDataVisibility,
}) => {
  return (
    <StyledMessageContainer data-type={message.type}>
      <MessageBubble>
        <MessageHeader>{message.type === 'user' ? 'You' : 'Assistant'}</MessageHeader>
        <MessageContent>{message.content}</MessageContent>
        <MessageFooter>
          {message.data ? (
            <ShowDataLink onClick={() => toggleDataVisibility(message.id)}>
              {visibleDataIds.has(message.id) ? 'Hide data' : 'Show data'}
            </ShowDataLink>
          ) : null}
          <MessageTimestamp>{message.timestamp.toLocaleString()}</MessageTimestamp>
        </MessageFooter>
        {visibleDataIds.has(message.id) && message.data ? <DataContainer data={message.data} /> : null}
      </MessageBubble>
    </StyledMessageContainer>
  );
};
