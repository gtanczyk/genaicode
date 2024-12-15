import React, { useState } from 'react';
import { RcConfig } from '../../../../config-lib.js';
import { dispatchCustomEvent, useCustomEvent } from '../hooks/custom-events.js';
import {
  ModalOverlay,
  ModalContent,
  ModalHeader,
  CloseButton,
  FormGroup,
  Label,
} from './service-configuration/service-configuration-modal-styles.js';
import styled from 'styled-components';

export function dispatchRcConfigModalOpen() {
  dispatchCustomEvent('openRcConfigModal');
}

type RcConfigModalProps = {
  rcConfig: RcConfig | null;
};

export const RcConfigModal: React.FC<RcConfigModalProps> = ({ rcConfig }) => {
  const [isOpen, setOpen] = useState(false);

  useCustomEvent('openRcConfigModal', () => setOpen(true));

  const onClose = () => {
    setOpen(false);
  };

  if (!isOpen || !rcConfig) return null;

  return (
    <ModalOverlay
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rc-config-title"
    >
      <ModalContent>
        <CloseButton onClick={onClose} aria-label="Close RC configuration modal">
          &times;
        </CloseButton>
        <ModalHeader>
          <h2 id="rc-config-title">RC Configuration</h2>
        </ModalHeader>

        <ConfigContainer>
          <FormGroup>
            <Label>Root Directory</Label>
            <ConfigValue>{rcConfig.rootDir}</ConfigValue>
          </FormGroup>

          {rcConfig.lintCommand && (
            <FormGroup>
              <Label>Lint Command</Label>
              <ConfigValue>{rcConfig.lintCommand}</ConfigValue>
            </FormGroup>
          )}

          {rcConfig.extensions && rcConfig.extensions.length > 0 && (
            <FormGroup>
              <Label>Extensions</Label>
              <ConfigValue>{rcConfig.extensions.join(', ')}</ConfigValue>
            </FormGroup>
          )}

          {rcConfig.ignorePaths && rcConfig.ignorePaths.length > 0 && (
            <FormGroup>
              <Label>Ignore Paths</Label>
              <ConfigValue>{rcConfig.ignorePaths.join(', ')}</ConfigValue>
            </FormGroup>
          )}

          {rcConfig.importantContext && (
            <FormGroup>
              <Label>Important Context</Label>
              <ConfigValue>
                {rcConfig.importantContext.files
                  ? `Files: ${rcConfig.importantContext.files.join(', ')}`
                  : 'None'}
              </ConfigValue>
            </FormGroup>
          )}

          {rcConfig.modelOverrides && (
            <FormGroup>
              <Label>Model Overrides</Label>
              <ConfigValue>
                <pre>{JSON.stringify(rcConfig.modelOverrides, null, 2)}</pre>
              </ConfigValue>
            </FormGroup>
          )}
        </ConfigContainer>
      </ModalContent>
    </ModalOverlay>
  );
};

const ConfigContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
`;

const ConfigValue = styled.div`
  color: ${({ theme }) => theme.colors.text};
  font-family: monospace;
  background-color: ${({ theme }) => theme.colors.backgroundSecondary};
  padding: 0.5rem;
  border-radius: 4px;
  overflow-x: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
  }
`;