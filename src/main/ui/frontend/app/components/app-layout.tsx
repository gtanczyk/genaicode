import React, { ReactNode } from 'react';
import styled from 'styled-components';
import '@fontsource/press-start-2p';
import { UsageDisplay } from './usage-display.js';
import { Usage } from '../api/api-types.js';

interface AppLayoutProps {
  themeToggle: ReactNode;
  infoIcon: ReactNode;
  chatInterface: ReactNode;
  inputArea: ReactNode;
  usage: Usage;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ themeToggle, infoIcon, chatInterface, inputArea, usage }) => {
  return (
    <AppContainer>
      <AppHeader>
        <AppTitle>GenAIcode</AppTitle>
        <HeaderRightSection>
          <UsageDisplay usage={usage} />
          <IconContainer>
            {themeToggle}
            {infoIcon}
          </IconContainer>
        </HeaderRightSection>
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
  text-transform: uppercase;
  font-family: 'Press Start 2P', system-ui;
  color: ${({ theme }) => theme.colors.primary};
  margin: 0;
`;

const HeaderRightSection = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const IconContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MainContent = styled.main`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`;

const ChatContainer = styled.div`
  flex-grow: 1;
  overflow: hidden;
  margin-bottom: 20px;
`;

const InputContainer = styled.div`
  flex-shrink: 0;
`;
