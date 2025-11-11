import React from 'react';
import styled from 'styled-components';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types.js';

interface SelectFieldProps {
  field: StructuredQuestionField;
  value: string;
  onChange: (value: string) => void;
}

export const SelectField: React.FC<SelectFieldProps> = ({ field, value, onChange }) => {
  return (
    <FieldContainer>
      <Label htmlFor={field.id}>{field.label}{field.required && ' *'}</Label>
      <StyledSelect
        id={field.id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      >
        {field.placeholder && <option value="">{field.placeholder}</option>}
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </StyledSelect>
    </FieldContainer>
  );
};

const FieldContainer = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
`;

const Label = styled.label`
  margin-bottom: 8px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;

const StyledSelect = styled.select`
  padding: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;
