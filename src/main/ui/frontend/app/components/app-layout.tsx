import React, { ReactNode } from 'react';
import styled from 'styled-components';

interface AppLayoutProps {
  themeToggle: ReactNode;
  infoIcon: ReactNode;
  chatInterface: ReactNode;
  inputArea: ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ themeToggle, infoIcon, chatInterface, inputArea }) => {
  return (
    <AppContainer>
      <AppHeader>
        <AppTitle>GenAIcode</AppTitle>
        <IconContainer>
          {themeToggle}
          {infoIcon}
        </IconContainer>
      </AppHeader>
      <MainContent>
        <ChatContainer>{chatInterface}</ChatContainer>
        <InputContainer>{inputArea}</InputContainer>
      </MainContent>
    </AppContainer>
  );
};

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
`;

const AppHeader = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
`;

const AppTitle = styled.h1`
  color: ${({ theme }) => theme.colors.primary};
  margin: 0;
`;

const IconContainer = styled.div`
  display: flex;
  gap: 10px;
`;

const MainContent = styled.main`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0; // This is important for nested flex containers
`;

const ChatContainer = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  margin-bottom: 20px;
`;

const InputContainer = styled.div`
  flex-shrink: 0;
`;