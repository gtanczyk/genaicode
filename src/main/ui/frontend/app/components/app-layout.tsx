import React, { ReactNode, useState } from 'react';
import styled from 'styled-components';
import '@fontsource/press-start-2p';
import { UsageDisplay } from './usage-display.js';
import { Usage } from '../../../common/api-types.js';
import { ContentGenerationIcon, dispatchContentGenerationModelOpen } from './content-generation-modal.js';
import { dispatchHealthCheckModalOpen, HealthCheckIcon } from './health-check-modal.js';
import {
  dispatchServiceConfigurationModalOpen,
  ServiceConfigurationIcon,
} from './service-configuration/service-configuration-modal.js';
import { HamburgerMenu } from './hamburger-menu/hamburger-menu.js';
import { MenuItem } from './hamburger-menu/types.js';
import { dispatchRcConfigModalOpen } from './rc-config-modal.js';
import { InfoIcon } from './info-icon.js';
import { GenaicodeConfigIcon, dispatchGenaicodeConfigModalOpen } from './genaicode-config/genaicode-config-modal.js';
import { version } from '../../../../../../package.json';
import { ToggleButton } from './toggle-button.js';
import { GraphToggleButtonWrapper } from './chat/graph-toggle-button.js';
import { ContextManagerModal } from './context-manager/context-manager-modal.js';
import { ContextManagerToggleButtonWrapper } from './chat/context-manager-toggle-button.js';
import { useChatState } from '../contexts/chat-state-context.js';
import { ContextManagerIcon } from './context-manager/context-manager-icon.js';
import { ContextCompressionModal } from './context-compression-modal.js';
import { CompressionToggleButtonWrapper } from './chat/compression-toggle-button.js';

interface AppLayoutProps {
  themeToggle: ReactNode;
  chatInterface: ReactNode;
  inputArea: ReactNode;
  usage: Usage;
  toggleTheme: () => void;
}

const GITHUB_ISSUES_URL = 'https://github.com/gtanczyk/genaicode/issues';

export const AppLayout: React.FC<AppLayoutProps> = ({ themeToggle, chatInterface, inputArea, usage, toggleTheme }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { toggleContextManager } = useChatState();

  const menuItems: MenuItem[] = [
    {
      content: <ServiceConfigurationIcon />,
      ariaLabel: 'Service Configuration',
      key: 'service-config',
      onClick: dispatchServiceConfigurationModalOpen,
    },
    {
      content: <HealthCheckIcon />,
      ariaLabel: 'Health Check',
      key: 'health-check',
      onClick: dispatchHealthCheckModalOpen,
    },
    {
      content: <ContentGenerationIcon />,
      ariaLabel: 'Content Generation',
      key: 'content-gen',
      onClick: dispatchContentGenerationModelOpen,
    },
    {
      content: <ContextManagerIcon />,
      ariaLabel: 'Manage Context',
      key: 'manage-context',
      onClick: toggleContextManager,
    },
    {
      content: <GenaicodeConfigIcon />,
      ariaLabel: 'Genaicode Config',
      key: 'genaicode-config',
      onClick: dispatchGenaicodeConfigModalOpen,
    },
    {
      content: themeToggle,
      ariaLabel: 'Theme Toggle',
      key: 'theme-toggle',
      onClick: toggleTheme,
    },
    {
      content: <InfoIcon />,
      ariaLabel: 'Information',
      key: 'info',
      onClick: dispatchRcConfigModalOpen,
    },
    {
      content: <ToggleButton>🐛</ToggleButton>,
      ariaLabel: 'Report Bug',
      key: 'report-bug',
      onClick: () => window.open(GITHUB_ISSUES_URL, '_blank', 'noopener,noreferrer'),
    },
  ];

  return (
    <AppContainer>
      <AppHeader>
        <HeaderLeftSection>
          <TitleContainer>
            <AppTitle>GenAIcode</AppTitle>
            <VersionText>v{version}</VersionText>
          </TitleContainer>
        </HeaderLeftSection>
        <HeaderRightSection>
          <UsageDisplayWrapper>
            <UsageDisplay usage={usage} />
          </UsageDisplayWrapper>
          <HamburgerMenuWrapper>
            <HamburgerMenu
              menuItems={menuItems}
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen(!isMenuOpen)}
              buttonAriaLabel="Toggle navigation menu"
              menuAriaLabel="Navigation menu"
              position={{ top: '100%', right: 0 }}
            />
          </HamburgerMenuWrapper>
        </HeaderRightSection>
      </AppHeader>
      <MainContent>
        <ChatContainer>{chatInterface}</ChatContainer>
        <InputContainer>{inputArea}</InputContainer>
        <GraphToggleButtonWrapper />

        <CompressionToggleButtonWrapper />
        <ContextManagerToggleButtonWrapper />

        <ContextManagerModal />
        <ContextCompressionModal />
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

const TitleContainer = styled.div`
  position: relative;
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

const VersionText = styled.span`
  position: absolute;
  bottom: 0;
  right: 0;
  font-size: 0.6rem;
  color: ${({ theme }) => theme.colors.text};
  background-color: ${({ theme }) => theme.colors.backgroundAlt};
  padding: 2px 4px;
  border-radius: 3px;
  transform: translateY(100%);
  white-space: nowrap;
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

const HamburgerMenuWrapper = styled.div`
  display: flex;
  align-items: center;

  @media (max-width: 576px) {
    position: relative;
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
