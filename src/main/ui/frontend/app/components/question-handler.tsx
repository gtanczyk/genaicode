import React, { useState, useEffect, useContext, useRef } from 'react';
import { ChatStateContext } from '../contexts/chat-state-context';
import styled from 'styled-components';
import { StyledTextarea } from './styled-textarea';
import { Question } from '../../../common/api-types';
import { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';
import { AiServiceSelector } from './input-area/ai-service-selector';
import { ImageUpload } from './input-area/image-upload'; // Import ImageUpload
import { UploadIcon } from './icons';
import { PromptActionTypeSelector } from './prompt-action-type-selector.js';
import { StructuredQuestionFormComponent } from './structured-question/structured-question-form.js';
import { StructuredQuestionResponse } from '../../../../prompt/steps/step-ask-question/step-ask-question-types.js';

interface QuestionHandlerProps {
  onSubmit: (
    answer: string,
    images?: File[],
    confirmed?: boolean,
    aiService?: AiServiceType,
    selectedActionType?: string,
    structuredResponse?: StructuredQuestionResponse,
  ) => void;
  onInterrupt: () => void;
  onPauseResume: () => void;
  question: Question | null;
  codegenOptions: CodegenOptions;
  executionStatus: 'idle' | 'executing' | 'paused';
}

export const QuestionHandler = ({
  onSubmit,
  onInterrupt,
  onPauseResume,
  question,
  codegenOptions,
  executionStatus,
}: QuestionHandlerProps) => {
  const [answer, setAnswer] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const { suggestions } = useContext(ChatStateContext) ?? { suggestions: [] };
  const [error, setError] = useState<string | null>(null);
  const [aiService, setAiService] = useState<AiServiceType>(codegenOptions.aiService);
  const [selectedActionType, setSelectedActionType] = useState<string | undefined>(undefined);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Function to handle pasting images into the textarea
  const handleImagePaste = (file: File) => {
    // Add the pasted file to the images state
    // Ensure not to exceed maximum image count if needed (add validation if required)
    setImages((prevImages) => [...prevImages, file]);
    setImageError(null); // Clear any previous image errors
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((answer.trim() || images.length > 0) && question) {
      // Allow submit if answer OR images exist
      try {
        await onSubmit(answer, images, undefined, aiService, selectedActionType); // Pass images
        setAnswer('');
        setImages([]); // Clear images after submit
        setError(null);
        setImageError(null);
      } catch (err) {
        // Use err instead of error
        console.error('Error submitting answer:', err);
        setError('Failed to submit the answer. Please try again.');
      }
    }
  };

  const handleConfirmation = async (isYes: boolean) => {
    try {
      await onSubmit(answer, images, isYes, aiService, selectedActionType); // Pass images
      setAnswer(''); // Clear answer as well on confirmation
      setImages([]); // Clear images after confirmation
      setError(null);
      setImageError(null);
    } catch (err) {
      // Use err instead of error
      console.error('Error submitting confirmation:', err);
      setError('Failed to submit the confirmation. Please try again.');
    }
  };

  const handleStructuredSubmit = async (values: Record<string, string | string[] | boolean>) => {
    try {
      const response: StructuredQuestionResponse = {
        submitted: true,
        values,
      };
      await onSubmit('', undefined, undefined, aiService, selectedActionType, response);
      setError(null);
    } catch (err) {
      console.error('Error submitting structured question:', err);
      setError('Failed to submit the form. Please try again.');
    }
  };

  const handleStructuredCancel = async () => {
    try {
      const response: StructuredQuestionResponse = {
        submitted: false,
        values: {},
      };
      await onSubmit('', undefined, undefined, aiService, selectedActionType, response);
      setError(null);
    } catch (err) {
      console.error('Error cancelling structured question:', err);
      setError('Failed to cancel the form. Please try again.');
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setAnswer(suggestion);
    setIsDropdownOpen(false);
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const isPaused = executionStatus === 'paused';

  const isRegularQuestion =
    !question?.confirmation ||
    (!question.confirmation.confirmLabel && !question.confirmation.declineLabel && !question.confirmation.secret);

  // Render structured form without HandlerContainer wrapper
  if (question?.structuredForm) {
    return (
      <>
        <StructuredQuestionFormComponent
          form={question.structuredForm}
          onSubmit={handleStructuredSubmit}
          onCancel={handleStructuredCancel}
        />
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </>
    );
  }

  return (
    <HandlerContainer>
      {question ? (
        <AnswerForm onSubmit={handleSubmit}>
          <p>{question.text}</p>
          {question.confirmation?.secret ? (
            <StyledPasswordInput
              type="password"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Enter secret"
              autoFocus
            />
          ) : (
            question.confirmation?.includeAnswer !== false && (
              <>
                <StyledTextarea
                  value={answer}
                  onChange={setAnswer}
                  placeholder="Enter your answer here or select a suggestion"
                  maxViewportHeight={0.3}
                  onImagePaste={handleImagePaste}
                />
                <ImageUpload
                  images={images}
                  onImagesChange={setImages}
                  error={imageError}
                  setError={setImageError}
                  fileInputRef={fileInputRef}
                />
              </>
            )
          )}
          {question.confirmation?.secret ? (
            <ButtonGroup>
              <SubmitButton type="submit" disabled={!answer.trim()}>
                Submit
              </SubmitButton>
              <ConfirmButton onClick={() => handleConfirmation(false)} data-secondary="true">
                Decline
              </ConfirmButton>
              <InterruptButton onClick={onInterrupt}>Interrupt</InterruptButton>
            </ButtonGroup>
          ) : isRegularQuestion ? (
            <ButtonGroup>
              <SubmitButton type="submit" disabled={!answer.trim() && images.length === 0}>
                Submit Answer
              </SubmitButton>
              <UploadButton type="button" onClick={handleUploadClick} title="Upload Images">
                <UploadIcon />
              </UploadButton>
              <AiServiceSelector value={aiService} onChange={setAiService} disabled={false} />
              {question.confirmation?.promptActionType && (
                <PromptActionTypeSelector
                  value={selectedActionType}
                  onChange={setSelectedActionType}
                  disabled={false}
                />
              )}
              {suggestions && suggestions.length > 0 && (
                <DropdownWrapper ref={dropdownRef}>
                  <DropdownButton type="button" onClick={toggleDropdown}>
                    {suggestions[0]}
                    {suggestions.length > 1 && <Arrow> ▼</Arrow>}
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
          ) : (
            <ButtonGroup>
              <ConfirmButton onClick={() => handleConfirmation(true)}>
                {question.confirmation?.confirmLabel}
              </ConfirmButton>
              <ConfirmButton onClick={() => handleConfirmation(false)} data-secondary="true">
                {question.confirmation?.declineLabel}
              </ConfirmButton>
              <AiServiceSelector value={aiService} onChange={setAiService} disabled={false} />
              {question.confirmation?.promptActionType && (
                <PromptActionTypeSelector
                  value={selectedActionType}
                  onChange={setSelectedActionType}
                  disabled={false}
                />
              )}
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

const StyledPasswordInput = styled.input`
  width: 100%;
  padding: 10px;
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-family: inherit;
  font-size: 14px;
  box-sizing: border-box;
  margin-bottom: 10px;
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
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;

  &:hover {
    background-color: ${(props) => props.theme.colors.primary + '22'};
  }
`;

const Arrow = styled.span`
  margin-left: 5px;
  font-size: 0.8em;
`;

const DropdownContainer = styled.div`
  position: absolute;
  bottom: 100%;
  left: 0;
  background-color: ${({ theme }) => theme.colors.inputBg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-width: 300px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 5px;
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
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
`;

const Button = styled.button`
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const SubmitButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.primary};

  &:hover:not(:disabled) {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }
`;

const UploadButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.buttonBg}; /* Or choose another appropriate color */

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg}dd;
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
