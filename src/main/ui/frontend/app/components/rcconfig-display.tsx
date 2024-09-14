import React from 'react';
import styled from 'styled-components';
import { RcConfig } from '../../../../config-lib.js';

const ConfigContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 16px;
  margin-bottom: 20px;
`;

const ConfigTitle = styled.h3`
  color: ${({ theme }) => theme.colors.primary};
  margin-top: 0;
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

interface RcConfigDisplayProps {
  rcConfig: RcConfig | null;
}

const RcConfigDisplay: React.FC<RcConfigDisplayProps> = ({ rcConfig }) => {
  if (!rcConfig) {
    return null;
  }

  return (
    <ConfigContainer>
      <ConfigTitle>RcConfig Settings</ConfigTitle>
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
    </ConfigContainer>
  );
};

export default RcConfigDisplay;