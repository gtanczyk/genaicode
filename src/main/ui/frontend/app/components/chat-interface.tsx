import React, { useState, useMemo } from 'react';
import styled from 'styled-components';

import { ChatMessage } from '../../../../common/content-bus-types.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages }) => {
  const uniqueMessages = useMemo(() => {
    const seenIds = new Set();
    return messages
      .filter((message) => {
        if (seenIds.has(message.id)) {
          return false;
        }
        seenIds.add(message.id);
        return true;
      })
      .reverse();
  }, [messages]);

  return (
    <ChatContainer>
      {uniqueMessages.map((message) => {
        switch (message.type) {
          case 'user':
          case 'assistant':
            return (
              <MessageContainer key={message.id} data-type={message.type}>
                <MessageBubble>
                  <MessageHeader>{message.type === 'user' ? 'You' : 'Assistant'}</MessageHeader>
                  <MessageContent>{message.content}</MessageContent>
                  <MessageTimestamp>{message.timestamp.toLocaleString()}</MessageTimestamp>
                </MessageBubble>
              </MessageContainer>
            );
          case 'system':
            return (
              <SystemMessage key={message.id}>
                <MessageContent>{message.content}</MessageContent>
                <MessageTimestamp>{message.timestamp.toLocaleString()}</MessageTimestamp>
              </SystemMessage>
            );
        }
      })}
    </ChatContainer>
  );
};

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
  max-height: calc(100vh - 200px); // Adjust based on your layout
  background-color: ${(props) => props.theme.colors.background};
`;

const MessageContainer = styled.div`
  display: flex;
  &[data-type='user'] {
    justify-content: flex-end;
  }

  &[data-type='assistant'] {
    justify-content: flex-start;
  }
`;

const MessageBubble = styled.div`
  color: ${(props) => props.theme.colors.text};
  border-radius: 12px;
  padding: 8px 12px;
  max-width: 70%;
  background-color: ${(props) => props.theme.colors.backgroundSecondary};

  [data-type='user'] & {
    background-color: ${(props) => props.theme.colors.primary};
    color: ${(props) => props.theme.colors.buttonText};
  }
`;

const MessageHeader = styled.div`
  font-weight: bold;
  margin-bottom: 4px;
`;

const MessageContent = styled.div`
  word-wrap: break-word;
`;

const MessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};
  text-align: right;
  margin-top: 4px;
`;

const SystemMessage = styled.div`
  background-color: ${(props) => props.theme.colors.backgroundSecondary};
  color: ${(props) => props.theme.colors.textSecondary};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  font-style: italic;
`;
