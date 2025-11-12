import React from 'react';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types';
import { FieldContainer, Label, OptionGroup, OptionLabel, ErrorMessage } from './structured-question-styles';

interface RadioGroupProps {
  field: StructuredQuestionField;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({ field, value, onChange, error }) => {
  return (
    <FieldContainer>
      <Label>
        {field.label}
        {field.required && <span style={{ color: 'var(--error-color, #f44336)', marginLeft: '4px' }}>*</span>}
      </Label>
      <OptionGroup>
        {field.options?.map((option) => (
          <OptionLabel key={option.value}>
            <input
              type="radio"
              id={`${field.id}-${option.value}`}
              name={field.id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </OptionLabel>
        ))}
      </OptionGroup>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldContainer>
  );
};
