import React, { useState } from 'react';
import styled from 'styled-components';
import { RcConfig } from '../../../../config-lib.js';

interface RcConfigDisplayProps {
  rcConfig: RcConfig | null;
}

export const RcConfigDisplay: React.FC<RcConfigDisplayProps> = ({ rcConfig }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!rcConfig) {
    return null;
  }

  const toggleTooltip = () => {
    setIsOpen(!isOpen);
  };

  return (
    <InfoIconWrapper>
      <IconButton onClick={toggleTooltip} aria-label="Show RcConfig Settings">
        ℹ️
      </IconButton>
      {isOpen && (
        <Tooltip>
          <TooltipTitle>RcConfig Settings</TooltipTitle>
          <ConfigItem>
            <ConfigLabel>Root Directory:</ConfigLabel>
            <ConfigValue>{rcConfig.rootDir}</ConfigValue>
          </ConfigItem>
          {rcConfig.lintCommand && (
            <ConfigItem>
              <ConfigLabel>Lint Command:</ConfigLabel>
              <ConfigValue>{rcConfig.lintCommand}</ConfigValue>
            </ConfigItem>
          )}
          {rcConfig.extensions && (
            <ConfigItem>
              <ConfigLabel>Extensions:</ConfigLabel>
              <ConfigValue>{rcConfig.extensions.join(', ')}</ConfigValue>
            </ConfigItem>
          )}
          {rcConfig.ignorePaths && (
            <ConfigItem>
              <ConfigLabel>Ignore Paths:</ConfigLabel>
              <ConfigValue>{rcConfig.ignorePaths.join(', ')}</ConfigValue>
            </ConfigItem>
          )}
          {rcConfig.importantContext && (
            <ConfigItem>
              <ConfigLabel>Important Context:</ConfigLabel>
              <ConfigValue>
                {rcConfig.importantContext.files ? `Files: ${rcConfig.importantContext.files.join(', ')}` : 'None'}
              </ConfigValue>
            </ConfigItem>
          )}
          {rcConfig.modelOverrides && (
            <ConfigItem>
              <ConfigLabel>Model Overrides:</ConfigLabel>
              <ConfigValue>{JSON.stringify(rcConfig.modelOverrides, null, 2)}</ConfigValue>
            </ConfigItem>
          )}
        </Tooltip>
      )}
    </InfoIconWrapper>
  );
};

const InfoIconWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

const IconButton = styled.button`
  background-color: transparent;
  color: ${({ theme }) => theme.colors.primary};
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary};
  }
`;

const Tooltip = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  width: 300px;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  max-height: 80vh;
  overflow-y: auto;
`;

const TooltipTitle = styled.h3`
  margin-top: 0;
  margin-bottom: 8px;
  color: ${({ theme }) => theme.colors.primary};
`;

const ConfigItem = styled.div`
  margin-bottom: 8px;
`;

const ConfigLabel = styled.span`
  font-weight: bold;
  margin-right: 8px;
`;

const ConfigValue = styled.span`
  color: ${({ theme }) => theme.colors.text};
`;