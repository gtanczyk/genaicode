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
import styled from 'styled-components';

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  max-width: 800px;
  margin: 8px 0;
`;

const ImageContainer = styled.div`
  position: relative;
  width: 100%;
  padding-bottom: 100%; /* Creates a square aspect ratio */
`;

const StyledImage = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.05);
`;

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
        {message.images && message.images.length > 0 && (
          <ImageGrid>
            {message.images.map((image, index) => (
              <ImageContainer key={index}>
                <StyledImage
                  src={`data:${image.mediaType};base64,${image.base64url}`}
                  alt={image.originalName || `Image ${index + 1}`}
                  title={image.originalName || `Image ${index + 1}`}
                />
              </ImageContainer>
            ))}
          </ImageGrid>
        )}
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