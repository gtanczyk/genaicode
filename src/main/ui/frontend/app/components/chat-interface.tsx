import React, { useState, useMemo } from 'react';
import styled from 'styled-components';

import { ChatMessage } from '../../../../common/content-bus-types.js';

interface ChatInterfaceProps {
  messages: ChatMessage[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages }) => {
  const [visibleDataIds, setVisibleDataIds] = useState<Set<string>>(new Set());

  const mergedMessages = useMemo(() => {
    const result: (ChatMessage & { parts?: ChatMessage[] })[] = [];
    let currentSystemBlock: (ChatMessage & { parts: ChatMessage[] }) | null = null;

    messages.forEach((message) => {
      if (message.type === 'system') {
        if (currentSystemBlock) {
          currentSystemBlock.parts.push(message);
        } else {
          currentSystemBlock = {
            ...message,
            parts: [message],
          };
          result.push(currentSystemBlock);
        }
      } else {
        currentSystemBlock = null;
        result.push(message);
      }
    });

    return result.reverse();
  }, [messages]);

  const toggleDataVisibility = (id: string) => {
    setVisibleDataIds((prevIds) => {
      const newIds = new Set(prevIds);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  };

  const renderData = (data: unknown) => {
    return <>{JSON.stringify(data, null, 2)}</>;
  };

  return (
    <ChatContainer>
      <MessagesContainer>
        {mergedMessages.map((message) => {
          switch (message.type) {
            case 'user':
            case 'assistant':
              return (
                <MessageContainer key={message.id} data-type={message.type}>
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
                    {visibleDataIds.has(message.id) && message.data ? (
                      <DataContainer>{renderData(message.data)}</DataContainer>
                    ) : null}
                  </MessageBubble>
                </MessageContainer>
              );
            case 'system':
              return (
                <SystemMessageContainer key={message.id}>
                  {message.parts!.map((part) => (
                    <SystemMessageContent key={part.id}>
                      {part.content}
                      <SystemMessageTimestamp>{part.timestamp.toLocaleString()}</SystemMessageTimestamp>
                      {part.data ? (
                        <ShowDataLink onClick={() => toggleDataVisibility(part.id)}>
                          {visibleDataIds.has(part.id) ? 'Hide data' : 'Show data'}
                        </ShowDataLink>
                      ) : null}
                      {visibleDataIds.has(part.id) && part.data ? (
                        <DataContainer>{renderData(part.data)}</DataContainer>
                      ) : null}
                    </SystemMessageContent>
                  ))}
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

const MessageFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
`;

const MessageTimestamp = styled.div`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.textSecondary};
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
  float: right;
`;

const ShowDataLink = styled.span`
  font-size: 0.8em;
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  text-decoration: underline;

  ${SystemMessageContent} & {
    float: right;
    margin-right: 5px;
  }

  &:hover {
    color: ${(props) => props.theme.colors.primaryHover};
  }
`;

const DataContainer = styled.pre`
  margin-top: 8px;
  padding: 8px;
  background-color: ${(props) => props.theme.colors.codeBackground};
  border-radius: 4px;
  font-size: 0.9em;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
`;
