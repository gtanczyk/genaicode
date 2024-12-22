import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatMessageFlags } from '../../../../../common/content-bus-types.js';
import { DataContainer } from './data-container.js';
import {
  MessageContainer as StyledMessageContainer,
  MessageBubble,
  MessageHeader,
  MessageContent,
  MessageFooter,
  MessageTimestamp,
  ShowDataLink,
  EditableContent,
  EditControls,
  EditButton,
  SaveButton,
  CancelButton,
  LoadingSpinner,
} from './styles/message-container-styles.js';
import styled from 'styled-components';
import { editMessage } from '../../api/api-client.js';

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
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at the end of the content
      textareaRef.current.selectionStart = textareaRef.current.value.length;
      textareaRef.current.selectionEnd = textareaRef.current.value.length;
    }
  }, [isEditing]);

  const handleEditClick = () => {
    setEditContent(message.content);
    setIsEditing(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(message.content);
    setError(null);
  };

  const validateEdit = (content: string): boolean => {
    if (!content.trim()) {
      setError('Message content cannot be empty');
      return false;
    }
    if (content === message.content) {
      setError('No changes made to the message');
      return false;
    }
    return true;
  };

  const handleSaveEdit = async () => {
    if (!validateEdit(editContent)) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await editMessage(message.id, editContent);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const isEditable = message.type !== 'system' && message.flags?.includes(ChatMessageFlags.MESSAGE_EDITABLE);

  return (
    <StyledMessageContainer data-type={message.type}>
      <MessageBubble data-edit-mode={isEditing}>
        <MessageHeader>
          <div>{message.type === 'user' ? 'You' : 'Assistant'}</div>
          {isEditable && !isEditing && (
            <EditButton onClick={handleEditClick} title="Edit message">
              ✎
            </EditButton>
          )}
        </MessageHeader>

        {isEditing ? (
          <>
            <EditableContent
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your message..."
            />
            {error && <div style={{ color: 'red', fontSize: '0.8em', marginTop: '4px' }}>{error}</div>}
            <EditControls>
              <SaveButton onClick={handleSaveEdit} disabled={isLoading}>
                {isLoading ? <LoadingSpinner /> : 'Save'}
              </SaveButton>
              <CancelButton onClick={handleCancelEdit} disabled={isLoading}>
                Cancel
              </CancelButton>
            </EditControls>
          </>
        ) : (
          <MessageContent>{message.content}</MessageContent>
        )}

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
