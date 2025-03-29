import React, { useState, useEffect, useContext, useRef } from 'react';
import { ChatStateContext } from '../contexts/chat-state-context';
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
  const { suggestions } = useContext(ChatStateContext) ?? {};
  const [error, setError] = useState<string | null>(null);
  const [aiService, setAiService] = useState<AiServiceType>(codegenOptions.aiService);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update aiService when codegenOptions.aiService changes
  useEffect(() => {
    setAiService(codegenOptions.aiService);
  }, [codegenOptions.aiService]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownRef]);

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

  const handleSuggestionClick = (suggestion: string) => {
    // Replace the current answer with the selected suggestion
    setAnswer(suggestion);
    setIsDropdownOpen(false); // Close dropdown after selection
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
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
              placeholder="Enter your answer here or select a suggestion"
              maxViewportHeight={0.3}
            />
          )}
          {!question.confirmation && (
            <ButtonGroup>
              <SubmitButton type="submit">Submit Answer</SubmitButton>
              <AiServiceSelector value={aiService} onChange={setAiService} disabled={false} />
              {/* Render suggestion dropdown if available and not a confirmation dialog */}
              {suggestions && suggestions.length > 0 && !question.confirmation && (
                <DropdownWrapper ref={dropdownRef}>
                  <DropdownButton type="button" onClick={toggleDropdown}>
                    Suggestions
                  </DropdownButton>
                  {isDropdownOpen && (
                    <DropdownContainer>
                      {suggestions.map((suggestion, index) => (
                        <DropdownItem key={index} onClick={() => handleSuggestionClick(suggestion)}>
                          {suggestion}
                        </DropdownItem>
                      ))}
                    </DropdownContainer>
                  )}
                </DropdownWrapper>
              )}
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

const DropdownWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

const DropdownButton = styled.button`
  background-color: ${(props) => props.theme.colors.backgroundSecondary};
  color: ${(props) => props.theme.colors.text};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover {
    background-color: ${(props) => props.theme.colors.primary + '22'};
  }
`;

const DropdownContainer = styled.div`
  position: absolute;
  bottom: 100%; /* Position above the button */
  left: 0;
  background-color: ${({ theme }) => theme.colors.inputBg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-width: 300px; /* Set max width for the dropdown */
  max-height: 200px; /* Add max height for scrollability */
  overflow-y: auto; /* Enable vertical scrolling */
  margin-bottom: 5px; /* Space between button and dropdown */
`;

const DropdownItem = styled.div`
  padding: 8px 12px;
  color: ${({ theme }) => theme.colors.inputText};
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary + '22'};
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  align-items: center; /* Align items vertically */
  justify-content: flex-start;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap; /* Allow wrapping if needed */
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
  margin-left: auto; /* Pushes interrupt button to the right */

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
