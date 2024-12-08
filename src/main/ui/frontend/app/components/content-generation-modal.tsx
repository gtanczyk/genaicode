import React, { useState } from 'react';
import styled from 'styled-components';
import { AiServiceType } from '../../../../codegen-types.js';
import { generateContent } from '../api/api-client.js';
import { FunctionCall } from '../../../../../ai-service/common.js';
import { dispatchCustomEvent, useCustomEvent } from '../hooks/custom-events.js';
import { useAvailableServices } from '../hooks/available-service.js';
import { ToggleButton } from './toggle-button.js';

interface ContentGenerationModalProps {
  currentService: AiServiceType;
}

export function dispatchContentGenerationModelOpen() {
  dispatchCustomEvent('openContentGenerationModel');
}

export function ContentGenerationIcon() {
  return (
    <ToggleButton onClick={dispatchContentGenerationModelOpen} aria-label="Content generation modal">
      ✨
    </ToggleButton>
  );
}

export const ContentGenerationModal: React.FC<ContentGenerationModalProps> = ({ currentService }) => {
  const [prompt, setPrompt] = useState('');
  const [service, setService] = useState<AiServiceType>(currentService);
  const [temperature, setTemperature] = useState(0.7);
  const [cheap, setCheap] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FunctionCall[] | null>(null);
  const [isOpen, setOpen] = useState(false);
  const onClose = () => setOpen(false);
  const [availableServices] = useAvailableServices();

  useCustomEvent('openContentGenerationModel', () => setOpen(true));

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await generateContent(prompt, temperature, cheap, {
        aiService: service,
        askQuestion: false,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ModalOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ModalContent>
        <CloseButton onClick={onClose}>&times;</CloseButton>
        <h2>Generate Content</h2>
        <Form onSubmit={handleSubmit}>
          <Label>
            Prompt
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              required
            />
          </Label>

          <Label>
            AI Service
            <Select value={service} onChange={(e) => setService(e.target.value as AiServiceType)}>
              {availableServices.map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </Select>
          </Label>

          <Label>
            Temperature ({temperature})
            <RangeContainer>
              <Range
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
              <RangeValue>{temperature}</RangeValue>
            </RangeContainer>
          </Label>

          <Label>
            <input type="checkbox" checked={cheap} onChange={(e) => setCheap(e.target.checked)} />
            Use cheap mode
          </Label>

          <Button type="submit" disabled={isLoading || !prompt}>
            {isLoading ? 'Generating...' : 'Generate'}
          </Button>
        </Form>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        {result && (
          <ResultContainer>
            {result.map((call, index) => (
              <div key={index}>
                <strong>{call.name}</strong>
                <pre>{JSON.stringify(call, null, 2)}</pre>
              </div>
            ))}
          </ResultContainer>
        )}
      </ModalContent>
    </ModalOverlay>
  );
};

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: ${({ theme }) => theme.colors.background};
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

const CloseButton = styled.button`
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.text};
  &:hover {
    opacity: 0.8;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Label = styled.label`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: ${({ theme }) => theme.colors.text};
`;

const Input = styled.textarea`
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  min-height: 100px;
  resize: vertical;
`;

const Select = styled.select`
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
`;

const RangeContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const Range = styled.input`
  flex: 1;
`;

const RangeValue = styled.span`
  min-width: 3rem;
  text-align: right;
`;

const Button = styled.button`
  padding: 0.5rem 1rem;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ResultContainer = styled.div`
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.backgroundSecondary};
  white-space: pre-wrap;
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  margin-top: 1rem;
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.error};
  border-radius: 4px;
`;
