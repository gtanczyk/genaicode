import React, { ReactNode } from 'react';
import styled from 'styled-components';

interface AppLayoutProps {
  themeToggle: ReactNode;
  codegenOptions: ReactNode;
  infoIcon: ReactNode;
  chatInterface: ReactNode;
  inputArea: ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  themeToggle,
  codegenOptions,
  infoIcon,
  chatInterface,
  inputArea,
}) => {
  return (
    <AppContainer>
      <AppHeader>
        <AppTitle>GenAIcode</AppTitle>
        <IconContainer>
          {themeToggle}
          {codegenOptions}
          {infoIcon}
        </IconContainer>
      </AppHeader>
      <ChatContainer>{chatInterface}</ChatContainer>
      <InputContainer>{inputArea}</InputContainer>
    </AppContainer>
  );
};

const AppContainer = styled.div`
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  height: 100vh;
`;

const AppHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`;

const AppTitle = styled.h1`
  color: ${({ theme }) => theme.colors.primary};
`;

const IconContainer = styled.div`
  display: flex;
  gap: 10px;
`;

const ChatContainer = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  margin-bottom: 20px;
`;

const InputContainer = styled.div`
  margin-top: auto;
`;
