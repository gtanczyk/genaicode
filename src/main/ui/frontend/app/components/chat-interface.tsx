import React, { useState, useMemo } from 'react';
import styled from 'styled-components';

import { ChatMessage } from '../../../../common/content-bus-types.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
}) => {
  const mergedMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    let currentSystemBlock: ChatMessage | null = null;

    messages.forEach((message) => {
      if (message.type === 'system') {
        if (currentSystemBlock) {
          currentSystemBlock.content += '\n' + message.content;
          currentSystemBlock.timestamp = message.timestamp;
        } else {
          currentSystemBlock = { ...message };
          result.push(currentSystemBlock);
        }
      } else {
        currentSystemBlock = null;
        result.push(message);
      }
    });

    return result.reverse();
  }, [messages]);

  return (
    <ChatContainer>
      <MessagesContainer>
        {mergedMessages.map((message, index) => {
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
                <SystemMessageContainer key={message.id}>
                  <SystemMessageContent>{message.content}</SystemMessageContent>
                  <SystemMessageTimestamp>{message.timestamp.toLocaleString()}</SystemMessageTimestamp>
                </SystemMessageContainer>
              );
          }
        })}
      </MessagesContainer>
    </ChatContainer>
  );
};

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: ${(props) => props.theme.colors.background};
`;

const MessagesContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
  flex-grow: 1;
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

const MessageContent = styled.pre`
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;
`;

const MessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};
  text-align: right;
  margin-top: 4px;
`;

const SystemMessageContainer = styled.div`
  background-color: ${(props) => props.theme.colors.systemMessageBackground};
  color: ${(props) => props.theme.colors.systemMessageText};
  border: 1px solid ${(props) => props.theme.colors.systemMessageBorder};
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  font-style: italic;
  font-size: 0.9em;
  opacity: 0.8;
`;

const SystemMessageContent = styled.pre`
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  margin: 0;
`;

const SystemMessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.systemMessageTimestamp};
  text-align: right;
  margin-top: 4px;
`;