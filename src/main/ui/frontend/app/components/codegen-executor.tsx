import React, { useState } from 'react';
import styled from 'styled-components';
import { CodegenOptions } from '../../../../codegen-types';

interface CodegenExecutorProps {
  onSubmit: (prompt: string, options: CodegenOptions) => void;
  onPause: () => void;
  onResume: () => void;
  onInterrupt: () => void;
  isExecuting: boolean;
  codegenOptions: CodegenOptions;
}

const ExecutorContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
`;

const ExecutorTitle = styled.h2`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 15px;
`;

const ExecutorForm = styled.form`
  display: flex;
  flex-direction: column;
`;

const ExecutorTextarea = styled.textarea`
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  padding: 10px;
  font-size: 14px;
  resize: vertical;
  min-height: 100px;
  margin-bottom: 10px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 10px;
`;

const Button = styled.button`
  background-color: ${({ theme }) => theme.colors.buttonBg};
  color: ${({ theme }) => theme.colors.buttonText};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover:not(:disabled) {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PrimaryButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.primary};
  color: #ffffff;
  border-color: ${({ theme }) => theme.colors.primary};

  &:hover:not(:disabled) {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }
`;

const WarningButton = styled(Button)`
  background-color: #d32f2f;
  color: #ffffff;
  border-color: #d32f2f;

  &:hover:not(:disabled) {
    background-color: #b71c1c;
  }
`;

const StatusMessage = styled.p`
  color: ${({ theme }) => theme.colors.secondary};
  font-style: italic;
  margin-top: 10px;
`;

const ErrorMessage = styled.p`
  color: #d32f2f;
  font-weight: bold;
  margin-top: 10px;
`;

const OptionsDisplay = styled.pre`
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 10px;
  font-size: 12px;
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 10px;
`;

const CodegenExecutor: React.FC<CodegenExecutorProps> = ({
  onSubmit,
  onPause,
  onResume,
  onInterrupt,
  isExecuting,
  codegenOptions,
}) => {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      try {
        await onSubmit(prompt, codegenOptions);
        setPrompt('');
        setError(null);
      } catch (err) {
        setError('Failed to execute codegen. Please try again.');
        console.error('Error executing codegen:', err);
      }
    }
  };

  return (
    <ExecutorContainer>
      <ExecutorTitle>Codegen Executor</ExecutorTitle>
      <OptionsDisplay>{JSON.stringify(codegenOptions, null, 2)}</OptionsDisplay>
      <ExecutorForm onSubmit={handleSubmit}>
        <ExecutorTextarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your codegen prompt here"
          rows={4}
        />
        <ButtonGroup>
          <PrimaryButton type="submit" disabled={isExecuting}>
            Execute
          </PrimaryButton>
          <Button onClick={onPause} disabled={!isExecuting} type="button">
            Pause
          </Button>
          <Button onClick={onResume} disabled={!isExecuting} type="button">
            Resume
          </Button>
          <WarningButton onClick={onInterrupt} disabled={!isExecuting} type="button">
            Interrupt
          </WarningButton>
        </ButtonGroup>
      </ExecutorForm>
      {isExecuting && <StatusMessage>Execution in progress...</StatusMessage>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </ExecutorContainer>
  );
};

export default CodegenExecutor;
