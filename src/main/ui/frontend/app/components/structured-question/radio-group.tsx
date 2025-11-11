import React from 'react';
import styled from 'styled-components';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types';

interface RadioGroupProps {
  field: StructuredQuestionField;
  value: string;
  onChange: (value: string) => void;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({ field, value, onChange }) => {
  return (
    <RadioGroupContainer>
      <label>{field.label}</label>
      {field.options?.map((option) => (
        <RadioOption key={option.value}>
          <input
            type="radio"
            id={`${field.id}-${option.value}`}
            name={field.id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <label htmlFor={`${field.id}-${option.value}`}>{option.label}</label>
        </RadioOption>
      ))}
    </RadioGroupContainer>
  );
};

const RadioGroupContainer = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;

  > label {
    font-weight: bold;
    margin-bottom: 0.5rem;
  }
`;

const RadioOption = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;

  input[type='radio'] {
    margin-right: 0.5rem;
  }
`;
