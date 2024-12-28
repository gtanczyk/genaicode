import React, { useState } from 'react';
import { CodegenOptions } from '../../../../../codegen-types.js';
import { dispatchCustomEvent, useCustomEvent } from '../../hooks/custom-events.js';
import { ToggleButton } from '../toggle-button.js';
import {
  ModalOverlay,
  ModalContent,
  ModalHeader,
  CloseButton,
  ServicesContainer,
  ErrorMessage,
  SuccessMessage,
  LoadingOverlay,
} from './genaicode-config-modal-styles.js';
import { AiServiceSelector } from '../input-area/ai-service-selector';
import styled from 'styled-components';

interface GenaicodeConfigModalProps {
  options: CodegenOptions;
  onOptionsChange: (newOptions: CodegenOptions) => void;
}

export function dispatchGenaicodeConfigModalOpen() {
  dispatchCustomEvent('openGenaicodeConfigModal');
}

export function GenaicodeConfigIcon() {
  return (
    <ToggleButton onClick={dispatchGenaicodeConfigModalOpen} aria-label="Open Genaicode configuration">
      🐺
    </ToggleButton>
  );
}

export const GenaicodeConfigModal: React.FC<GenaicodeConfigModalProps> = ({ options, onOptionsChange }) => {
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useCustomEvent('openGenaicodeConfigModal', () => setOpen(true));

  const onClose = () => {
    setOpen(false);
    setError(null);
    setSuccessMessage(null);
  };

  const handleUpdate = async (newOptions: CodegenOptions) => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      onOptionsChange(newOptions);
      setSuccessMessage('Configuration updated successfully');
    } catch (err) {
      setError('Failed to update configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    handleUpdate({ ...options, [name]: newValue });
  };

  const handleAiServiceChange = (aiService: string) => {
    handleUpdate({ ...options, aiService: aiService as CodegenOptions['aiService'] });
  };

  const handleIgnorePatternsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const patterns = e.target.value.split(',').map((p) => p.trim());
    handleUpdate({ ...options, ignorePatterns: patterns });
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="genaicode-config-title"
    >
      <ModalContent>
        <CloseButton onClick={onClose} aria-label="Close configuration modal">
          &times;
        </CloseButton>
        <ModalHeader>
          <h2 id="genaicode-config-title">Genaicode Configuration</h2>
        </ModalHeader>

        {error && (
          <ErrorMessage role="alert" aria-live="polite">
            {error}
          </ErrorMessage>
        )}
        {successMessage && (
          <SuccessMessage role="status" aria-live="polite">
            {successMessage}
          </SuccessMessage>
        )}

        <ServicesContainer>
          <FormGroup>
            <Label htmlFor="aiService">Default AI Service:</Label>
            <AiServiceSelector value={options.aiService} onChange={handleAiServiceChange} disabled={isLoading} />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="contentMask">Content Mask:</Label>
            <Input
              type="text"
              id="contentMask"
              name="contentMask"
              value={options.contentMask || ''}
              onChange={handleChange}
              disabled={isLoading}
            />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="ignorePatterns">Ignore Patterns:</Label>
            <Input
              type="text"
              id="ignorePatterns"
              name="ignorePatterns"
              value={options.ignorePatterns ? options.ignorePatterns.join(', ') : ''}
              onChange={handleIgnorePatternsChange}
              disabled={isLoading}
            />
            <small>Comma-separated list of patterns</small>
          </FormGroup>

          <FormGroup>
            <Label>File Operations:</Label>
            <Label htmlFor="allowFileCreate">
              <input
                type="checkbox"
                id="allowFileCreate"
                name="allowFileCreate"
                checked={options.allowFileCreate !== false}
                onChange={handleChange}
                disabled={isLoading}
              />
              Allow File Create
            </Label>
            <Label htmlFor="allowFileDelete">
              <input
                type="checkbox"
                id="allowFileDelete"
                name="allowFileDelete"
                checked={options.allowFileDelete !== false}
                onChange={handleChange}
                disabled={isLoading}
              />
              Allow File Delete
            </Label>
            <Label htmlFor="allowDirectoryCreate">
              <input
                type="checkbox"
                id="allowDirectoryCreate"
                name="allowDirectoryCreate"
                checked={options.allowDirectoryCreate !== false}
                onChange={handleChange}
                disabled={isLoading}
              />
              Allow Directory Create
            </Label>
            <Label htmlFor="allowFileMove">
              <input
                type="checkbox"
                id="allowFileMove"
                name="allowFileMove"
                checked={options.allowFileMove !== false}
                onChange={handleChange}
                disabled={isLoading}
              />
              Allow File Move
            </Label>
          </FormGroup>
        </ServicesContainer>

        {isLoading && (
          <LoadingOverlay role="status" aria-live="polite">
            Updating configuration...
          </LoadingOverlay>
        )}
      </ModalContent>
    </ModalOverlay>
  );
};

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 4px;
  color: ${(props) => props.theme.colors.text};
`;

const Input = styled.input`
  width: 100%;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.inputBg};
  color: ${(props) => props.theme.colors.inputText};

  &:disabled {
    background-color: ${(props) => props.theme.colors.disabled};
    cursor: not-allowed;
  }
`;
