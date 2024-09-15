import React, { useState } from 'react';
import styled from 'styled-components';

interface QuestionHandlerProps {
  onSubmit: (answer: string) => void;
  question: { id: string; text: string } | null;
}

export const QuestionHandler: React.FC<QuestionHandlerProps> = ({ onSubmit, question }) => {
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

  if (!question) {
    return null; // Don't render anything if there's no question
  }

  return (
    <HandlerContainer>
      <HandlerTitle>Question Handler</HandlerTitle>
      <QuestionContainer>
        <QuestionText>Question: {question.text}</QuestionText>
      </QuestionContainer>
      <AnswerForm onSubmit={handleSubmit}>
        <AnswerTextarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Enter your answer here"
          rows={4}
        />
        <SubmitButton type="submit">Submit Answer</SubmitButton>
      </AnswerForm>
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
`;

const HandlerTitle = styled.h2`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 15px;
`;

const QuestionContainer = styled.div`
  margin-bottom: 15px;
`;

const QuestionText = styled.p`
  color: ${({ theme }) => theme.colors.text};
  font-weight: bold;
  margin-bottom: 10px;
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

const SubmitButton = styled.button`
  background-color: ${({ theme }) => theme.colors.primary};
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 10px 15px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }
`;

const ErrorMessage = styled.p`
  color: #d32f2f;
  font-weight: bold;
  margin-top: 10px;
`;
