import React from 'react';
import styled from 'styled-components';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types.js';

interface FormFieldProps {
  field: StructuredQuestionField;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export const FormField: React.FC<FormFieldProps> = ({ field, value, onChange, error }) => {
  const { id, label, type, required, placeholder } = field;

  const renderInput = () => {
    const commonProps = {
      id,
      name: id,
      value: value || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
      placeholder,
      required,
    };

    switch (type) {
      case 'textarea':
        return <StyledTextarea {...commonProps} rows={4} />;
      case 'number':
      case 'email':
      case 'text':
      default:
        return <StyledInput type={type} {...commonProps} />;
    }
  };

  return (
    <FieldContainer>
      <Label htmlFor={id}>
        {label}
        {required && <RequiredIndicator>*</RequiredIndicator>}
      </Label>
      {renderInput()}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldContainer>
  );
};

const FieldContainer = styled.div`
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
`;

const Label = styled.label`
  margin-bottom: 8px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;

const RequiredIndicator = styled.span`
  color: ${({ theme }) => theme.colors.error};
  margin-left: 4px;
`;

const inputStyles = `
  width: 100%;
  padding: 10px;
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-family: inherit;
  font-size: 14px;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const StyledInput = styled.input`
  ${inputStyles}
`;

const StyledTextarea = styled.textarea`
  ${inputStyles}
  resize: vertical;
`;

const ErrorMessage = styled.span`
  color: ${({ theme }) => theme.colors.error};
  font-size: 12px;
  margin-top: 4px;
`;
