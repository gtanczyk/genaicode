import React, { useState } from 'react';
import styled from 'styled-components';
import { ChatMessage, CodegenExecution } from '../common/types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  codegenExecutions: CodegenExecution[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, codegenExecutions }) => {
  const [openExecutions, setOpenExecutions] = useState<Set<string>>(new Set());

  const toggleExecution = (id: string) => {
    setOpenExecutions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <ChatContainer>
      {messages.map((message) => {
        switch (message.type) {
          case 'user':
          case 'assistant':
            return (
              <MessageContainer key={message.id} data-type={message.type}>
                <MessageBubble>{message.content}</MessageBubble>
              </MessageContainer>
            );
          case 'system':
            return <SystemMessage key={message.id}>{message.content}</SystemMessage>;
        }
      })}
      {codegenExecutions.map((execution) => (
        <CodegenExecution key={execution.id}>
          <CodegenHeader onClick={() => toggleExecution(execution.id)}>
            <span>{execution.prompt}</span>
            <span>{openExecutions.has(execution.id) ? '▲' : '▼'}</span>
          </CodegenHeader>
          <CodegenContent data-is-open={openExecutions.has(execution.id)}>
            <pre>{execution.output}</pre>
          </CodegenContent>
        </CodegenExecution>
      ))}
    </ChatContainer>
  );
};

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
`;

const MessageContainer = styled.div`
  display: flex;
  &[data-type='user'] {
    align-items: flex-end;
  }

  &[data-type='assistant'] {
    align-items: flex-start;
  }
`;

const MessageBubble = styled.div`
  color: ${(props) => props.theme.colors.text};
  border-radius: 12px;
  padding: 8px 12px;
  max-width: 70%;

  background-color: ${(props) => props.theme.colors.secondary};
  [data-type='user'] & {
    background-color: ${(props) => props.theme.colors.primary};
  }
`;

const SystemMessage = styled.div`
  background-color: ${(props) => props.theme.colors.background};
  color: ${(props) => props.theme.colors.secondary};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  font-style: italic;
`;

const CodegenExecution = styled.div`
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 8px;
  margin: 8px 0;
`;

const CodegenHeader = styled.div`
  background-color: ${(props) => props.theme.colors.background};
  color: ${(props) => props.theme.colors.text};
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const CodegenContent = styled.div`
  padding: 8px 12px;

  &[data-is-open='true'] {
    display: block;
  }

  &[data-is-open='false'] {
    display: none;
  }
`;
