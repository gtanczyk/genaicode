import React from 'react';
import styled from 'styled-components';

interface CodegenOutputProps {
  output: string;
  askQuestionConversation: Array<{ question: string; answer: string }>;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

const OutputContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
`;

const OutputTitle = styled.h2`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 15px;
`;

const OutputSection = styled.div`
  margin-bottom: 20px;
`;

const SectionTitle = styled.h3`
  color: ${({ theme }) => theme.colors.secondary};
  margin-bottom: 10px;
`;

const OutputContent = styled.pre`
  background-color: ${({ theme }) => theme.colors.codeBackground};
  color: ${({ theme }) => theme.colors.codeText};
  padding: 15px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.5;
`;

const ConversationItem = styled.div`
  margin-bottom: 15px;
`;

const Question = styled.p`
  font-weight: bold;
  margin-bottom: 5px;
`;

const Answer = styled.p`
  margin-left: 20px;
`;

const FunctionCall = styled.div`
  margin-bottom: 15px;
`;

const FunctionName = styled.h4`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 5px;
`;

const FunctionArgs = styled.pre`
  background-color: ${({ theme }) => theme.colors.codeBackground};
  color: ${({ theme }) => theme.colors.codeText};
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 12px;
`;

const NoDataMessage = styled.p`
  color: ${({ theme }) => theme.colors.secondary};
  font-style: italic;
`;

const CodegenOutput: React.FC<CodegenOutputProps> = ({ output, askQuestionConversation, functionCalls }) => {
  return (
    <OutputContainer>
      <OutputTitle>Codegen Output</OutputTitle>
      
      <OutputSection>
        <SectionTitle>Generated Output</SectionTitle>
        <OutputContent>{output}</OutputContent>
      </OutputSection>

      <OutputSection>
        <SectionTitle>Ask-Question Conversation</SectionTitle>
        {askQuestionConversation.length === 0 ? (
          <NoDataMessage>No conversation history available.</NoDataMessage>
        ) : (
          askQuestionConversation.map((item, index) => (
            <ConversationItem key={index}>
              <Question>Question: {item.question}</Question>
              <Answer>Answer: {item.answer}</Answer>
            </ConversationItem>
          ))
        )}
      </OutputSection>

      <OutputSection>
        <SectionTitle>Function Calls</SectionTitle>
        {functionCalls.length === 0 ? (
          <NoDataMessage>No function calls recorded.</NoDataMessage>
        ) : (
          functionCalls.map((call, index) => (
            <FunctionCall key={index}>
              <FunctionName>{call.name}</FunctionName>
              <FunctionArgs>{JSON.stringify(call.args, null, 2)}</FunctionArgs>
            </FunctionCall>
          ))
        )}
      </OutputSection>
    </OutputContainer>
  );
};

export default CodegenOutput;