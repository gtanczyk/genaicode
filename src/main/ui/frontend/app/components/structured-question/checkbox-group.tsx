import React from 'react';
import styled from 'styled-components';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types';

interface CheckboxGroupProps {
  field: StructuredQuestionField;
  value: string[];
  onChange: (value: string[]) => void;
}

export const CheckboxGroup: React.FC<CheckboxGroupProps> = ({ field, value, onChange }) => {
  const handleChange = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  return (
    <CheckboxGroupContainer>
      <label>{field.label}</label>
      {field.options?.map((option) => (
        <CheckboxLabel key={option.value}>
          <input
            type="checkbox"
            value={option.value}
            checked={value.includes(option.value)}
            onChange={() => handleChange(option.value)}
          />
          {option.label}
        </CheckboxLabel>
      ))}
    </CheckboxGroupContainer>
  );
};

const CheckboxGroupContainer = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;

  label {
    margin-bottom: 0.5rem;
    font-weight: bold;
  }
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
  cursor: pointer;

  input {
    margin-right: 0.5rem;
  }
`;
