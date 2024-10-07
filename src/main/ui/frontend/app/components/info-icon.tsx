import React, { useState } from 'react';
import styled from 'styled-components';
import { RcConfig } from '../../../../config-lib.js';

type InfoIconProps = {
  rcConfig: RcConfig | null;
};

export const InfoIcon: React.FC<InfoIconProps> = ({ rcConfig }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleTooltip = () => {
    setIsOpen(!isOpen);
  };

  if (!rcConfig) {
    return null;
  }

  return (
    <IconWrapper onClick={toggleTooltip}>
      <Icon>ℹ️</Icon>
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
    </IconWrapper>
  );
};

const IconWrapper = styled.div`
  position: relative;
  display: inline-block;
  cursor: pointer;
`;

const Icon = styled.span`
  font-size: 24px;
  color: ${(props) => props.theme.colors.primary};
`;

const Tooltip = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  background-color: ${(props) => props.theme.colors.background};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  padding: 16px;
  min-width: 200px;
  max-width: 300px;
  z-index: 1000;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);

  @media (max-width: 576px) {
    left: 0;
    background-color: ${(props) => props.theme.colors.pageBackground};
    width: fit-content;
  }
`;

const TooltipTitle = styled.h3`
  margin-top: 0;
  margin-bottom: 8px;
  color: ${(props) => props.theme.colors.primary};
`;

const ConfigItem = styled.div`
  margin-bottom: 8px;
`;

const ConfigLabel = styled.span`
  font-weight: bold;
  margin-right: 8px;
`;

const ConfigValue = styled.span`
  color: ${(props) => props.theme.colors.text};
`;
