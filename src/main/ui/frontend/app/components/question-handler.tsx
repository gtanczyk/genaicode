import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { StyledTextarea } from './styled-textarea';
import { Question } from '../../../common/api-types';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import { AiServiceSelector } from './input-area/ai-service-selector';

interface QuestionHandlerProps {
  onSubmit: (answer: string, confirmed?: boolean, aiService?: AiServiceType) => void;
  onInterrupt: () => void;
  onPauseResume: () => void;
  question: Question | null;
  codegenOptions: CodegenOptions;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const QuestionHandler: React.FC<QuestionHandlerProps> = ({
  onSubmit,
  onInterrupt,
  onPauseResume,
  question,
  codegenOptions,
  executionStatus,
}) => {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiService, setAiService] = useState<AiServiceType>(codegenOptions.aiService);

  // Update aiService when codegenOptions.aiService changes
  useEffect(() => {
    setAiService(codegenOptions.aiService);
  }, [codegenOptions.aiService]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim() && question) {
      try {
        await onSubmit(answer, undefined, aiService);
        setAnswer('');
        setError(null);
      } catch (err) {
        console.error('Error submitting answer:', err);
        setError('Failed to submit the answer. Please try again.');
      }
    }
  };

  const handleConfirmation = async (isYes: boolean) => {
    try {
      await onSubmit(answer, isYes, aiService);
      setError(null);
    } catch (err) {
      console.error('Error submitting confirmation:', err);
      setError('Failed to submit the confirmation. Please try again.');
    }
  };

  const isPaused = executionStatus === 'paused';

  return (
    <HandlerContainer>
      {question ? (
        <AnswerForm onSubmit={handleSubmit}>
          {question.confirmation && <p>{question.text}</p>}
          {question.confirmation?.includeAnswer !== false && (
            <StyledTextarea
              value={answer}
              onChange={setAnswer}
              placeholder="Enter your answer here"
              maxViewportHeight={0.3}
            />
          )}
          {!question.confirmation && (
            <ButtonGroup>
              <SubmitButton type="submit">Submit Answer</SubmitButton>
              <AiServiceSelector value={aiService} onChange={setAiService} disabled={false} />
              <InterruptButton onClick={onInterrupt}>Interrupt</InterruptButton>
            </ButtonGroup>
          )}
          {question.confirmation && (
            <ButtonGroup>
              <ConfirmButton onClick={() => handleConfirmation(true)}>
                {question.confirmation.confirmLabel}
              </ConfirmButton>
              <ConfirmButton onClick={() => handleConfirmation(false)} data-secondary="true">
                {question.confirmation.declineLabel}
              </ConfirmButton>
              <AiServiceSelector value={aiService} onChange={setAiService} disabled={false} />
              <InterruptButton onClick={onInterrupt}>Interrupt</InterruptButton>
            </ButtonGroup>
          )}
        </AnswerForm>
      ) : (
        <ButtonGroup>
          <PauseResumeButton onClick={onPauseResume} isPaused={isPaused}>
            {isPaused ? 'Resume' : 'Pause'}
          </PauseResumeButton>
          <InterruptButton onClick={onInterrupt}>Interrupt</InterruptButton>
        </ButtonGroup>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </HandlerContainer>
  );
};

const HandlerContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 15px;
  margin-top: 10px;
  margin-bottom: 10px;
  max-width: 70%;
  width: 100%;
  box-sizing: border-box;
`;

const AnswerForm = styled.form`
  display: flex;
  flex-direction: column;

  > p {
    margin-top: 0;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  margin-top: 10px;
`;

const Button = styled.button`
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;
`;

const SubmitButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.primary};

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }
`;

const ConfirmButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.primary};
  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }

  &[data-secondary='true'] {
    background-color: ${({ theme }) => theme.colors.secondary};
    &:hover {
      background-color: ${({ theme }) => theme.colors.secondary}dd;
    }
  }
`;

const InterruptButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.error};
  margin-left: auto;

  &:hover {
    background-color: ${({ theme }) => theme.colors.error}dd;
  }
`;

const PauseResumeButton = styled(Button)<{ isPaused: boolean }>`
  background-color: ${({ theme, isPaused }) => (isPaused ? theme.colors.warning : theme.colors.info)};

  &:hover {
    background-color: ${({ theme, isPaused }) => (isPaused ? theme.colors.warning : theme.colors.info)}dd;
  }
`;

const ErrorMessage = styled.p`
  color: ${({ theme }) => theme.colors.error};
  font-weight: bold;
  margin-top: 10px;
  margin-bottom: 0;
`;
