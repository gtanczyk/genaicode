import React, { useState } from 'react';
import styled from 'styled-components';

interface QuestionHandlerProps {
  onSubmit: (answer: string) => void;
  onInterrupt: () => void;
  onPauseResume: () => void;
  question: { id: string; text: string; isConfirmation: boolean } | null;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const QuestionHandler: React.FC<QuestionHandlerProps> = ({
  onSubmit,
  onInterrupt,
  onPauseResume,
  question,
  executionStatus,
}) => {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim() && question) {
      try {
        await onSubmit(answer);
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
      await onSubmit(isYes ? 'yes' : 'no');
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
        question.isConfirmation ? (
          <ConfirmationButtons>
            <ConfirmButton onClick={() => handleConfirmation(true)}>Yes</ConfirmButton>
            <ConfirmButton onClick={() => handleConfirmation(false)} data-secondary="true">
              No
            </ConfirmButton>
            <InterruptButton onClick={onInterrupt}>INTERRUPT</InterruptButton>
          </ConfirmationButtons>
        ) : (
          <AnswerForm onSubmit={handleSubmit}>
            <AnswerTextarea
              value={answer}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAnswer(e.target.value)}
              placeholder="Enter your answer here"
              rows={4}
            />
            <ConfirmationButtons>
              <SubmitButton type="submit">Submit Answer</SubmitButton>
              <InterruptButton onClick={onInterrupt}>INTERRUPT</InterruptButton>
            </ConfirmationButtons>
          </AnswerForm>
        )
      ) : (
        <ConfirmationButtons>
          <PauseResumeButton onClick={onPauseResume} isPaused={isPaused}>
            {isPaused ? 'Resume' : 'Pause'}
          </PauseResumeButton>
          <InterruptButton onClick={onInterrupt}>INTERRUPT</InterruptButton>
        </ConfirmationButtons>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </HandlerContainer>
  );
};

const HandlerContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  position: relative;
`;

const AnswerForm = styled.form`
  display: flex;
  flex-direction: column;
`;

const AnswerTextarea = styled.textarea`
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

const Button = styled.button`
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 10px 15px;
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

const ConfirmationButtons = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 15px;
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
`;
