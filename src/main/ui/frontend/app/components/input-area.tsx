import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';

interface InputAreaProps {
  onSubmit: (input: string) => void;
  onCancel?: () => void;
  isExecuting: boolean;
  placeholder?: string;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSubmit, onCancel, isExecuting, placeholder }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = () => {
    if (input.trim()) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    setInput('');
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <InputContainer>
      <StyledTextarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyUp={handleKeyUp}
        placeholder={placeholder || 'Enter your prompt or response here...'}
        disabled={isExecuting}
      />
      <ButtonContainer>
        <SubmitButton onClick={handleSubmit} disabled={isExecuting || !input.trim()}>
          Submit
        </SubmitButton>
        {onCancel && (
          <CancelButton onClick={handleCancel} disabled={isExecuting}>
            Cancel
          </CancelButton>
        )}
      </ButtonContainer>
    </InputContainer>
  );
};

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.colors.background};
  border-top: 1px solid ${(props) => props.theme.colors.border};
  padding: 16px;
`;

const StyledTextarea = styled.textarea`
  width: 100%;
  min-height: 60px;
  resize: vertical;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  background-color: ${(props) => props.theme.colors.inputBg};
  color: ${(props) => props.theme.colors.inputText};
  margin-bottom: 8px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.colors.primary};
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  justify-content: space-between;
`;

const SubmitButton = styled.button`
  background-color: ${(props) => props.theme.colors.primary};
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${(props) => props.theme.colors.primary}dd;
  }

  &:disabled {
    background-color: ${(props) => props.theme.colors.secondary};
    cursor: not-allowed;
  }
`;

const CancelButton = styled(SubmitButton)`
  background-color: ${(props) => props.theme.colors.buttonBg};
  color: ${(props) => props.theme.colors.buttonText};
  border: 1px solid ${(props) => props.theme.colors.border};

  &:hover {
    background-color: ${(props) => props.theme.colors.buttonHoverBg};
  }
`;
