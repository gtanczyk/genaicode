import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { CodegenOptions } from '../../../../codegen-types.js';
import { CodegenOptionsForm } from './codegen-options.js';

interface InputAreaProps {
  onSubmit: (input: string) => void;
  onCancel?: () => void;
  isExecuting: boolean;
  onInterrupt: () => void;
  onPause: () => void;
  onResume: () => void;
  codegenOptions: CodegenOptions;
  onOptionsChange: (newOptions: CodegenOptions) => void;
}

export const InputArea: React.FC<InputAreaProps> = ({
  onSubmit,
  onCancel,
  isExecuting,
  onInterrupt,
  onPause,
  onResume,
  codegenOptions,
  onOptionsChange,
}) => {
  const [input, setInput] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExecuting]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleOptions = () => {
    setShowOptions(!showOptions);
  };

  return (
    <InputContainer>
      <StyledTextarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={'Enter your codegen prompt here...'}
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
        {isExecuting && (
          <>
            <ControlButton onClick={onInterrupt}>Interrupt</ControlButton>
            <ControlButton onClick={onPause}>Pause</ControlButton>
            <ControlButton onClick={onResume}>Resume</ControlButton>
          </>
        )}
        <OptionsToggle onClick={toggleOptions}>{showOptions ? 'Hide Options' : 'Show Options'}</OptionsToggle>
      </ButtonContainer>
      {showOptions && (
        <CodegenOptionsForm options={codegenOptions} onOptionsChange={onOptionsChange} disabled={isExecuting} />
      )}
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

  &:disabled {
    background-color: ${(props) => props.theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
`;

const Button = styled.button`
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s;

  &:disabled {
    background-color: ${(props) => props.theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const SubmitButton = styled(Button)`
  background-color: ${(props) => props.theme.colors.primary};
  color: ${(props) => props.theme.colors.buttonText};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.primaryHover};
  }
`;

const CancelButton = styled(Button)`
  background-color: ${(props) => props.theme.colors.buttonBg};
  color: ${(props) => props.theme.colors.buttonText};
  border: 1px solid ${(props) => props.theme.colors.border};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.buttonHoverBg};
  }
`;

const ControlButton = styled(Button)`
  background-color: ${(props) => props.theme.colors.buttonBg};
  color: ${(props) => props.theme.colors.buttonText};
  border: 1px solid ${(props) => props.theme.colors.border};

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.buttonHoverBg};
  }
`;

const OptionsToggle = styled(Button)`
  background-color: ${(props) => props.theme.colors.buttonBg};
  color: ${(props) => props.theme.colors.buttonText};
  border: 1px solid ${(props) => props.theme.colors.border};
  margin-left: auto;

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.colors.buttonHoverBg};
  }
`;
