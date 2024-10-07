import React, { ReactNode, useState } from 'react';
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <AppContainer>
      <AppHeader>
        <HeaderLeftSection>
          <MenuButton onClick={() => setIsMenuOpen(!isMenuOpen)}>☰</MenuButton>
          <AppTitle>GenAIcode</AppTitle>
        </HeaderLeftSection>
        <HeaderRightSection>
          <UsageDisplayWrapper>
            <UsageDisplay usage={usage} />
          </UsageDisplayWrapper>
          <IconContainer isOpen={isMenuOpen}>
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
  padding: 0 10px;
`;

const AppHeader = styled.header`
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  flex-wrap: nowrap;
  gap: 10px;
`;

const HeaderLeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const MenuButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  display: none;

  @media (max-width: 576px) {
    display: block;
  }
`;

const AppTitle = styled.h1`
  text-transform: uppercase;
  font-family: 'Press Start 2P', system-ui;
  color: ${({ theme }) => theme.colors.primary};
  margin: 0;
  font-size: clamp(0.6rem, 2.5vw, 1.5rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HeaderRightSection = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  flex-shrink: 0;

  @media (max-width: 576px) {
    gap: 8px;
  }
`;

const UsageDisplayWrapper = styled.div`
  flex-shrink: 1;
  min-width: 0;
`;

const IconContainer = styled.div<{ isOpen: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

  @media (max-width: 576px) {
    display: ${({ isOpen }) => (isOpen ? 'flex' : 'none')};
    flex-direction: column;
    position: absolute;
    z-index: 2;
    top: 100%;
    left: -10px;
    background-color: ${({ theme }) => theme.colors.pageBackground};
    padding: 10px;
    border-radius: 4px;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    box-shadow: 0 10px 10px rgba(0, 0, 0, 0.1);
  }
`;

const MainContent = styled.main`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
  position: relative;
  z-index: 1;
`;

const ChatContainer = styled.div`
  flex-grow: 1;
  overflow: hidden;
  margin-bottom: 20px;
`;

const InputContainer = styled.div`
  flex-shrink: 0;
`;
