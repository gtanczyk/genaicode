import React from 'react';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types';
import { FieldContainer, Label, OptionGroup, OptionLabel, ErrorMessage } from './structured-question-styles';

interface CheckboxGroupProps {
  field: StructuredQuestionField;
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}

export const CheckboxGroup: React.FC<CheckboxGroupProps> = ({ field, value, onChange, error }) => {
  const handleChange = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

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
              type="checkbox"
              value={option.value}
              checked={value.includes(option.value)}
              onChange={() => handleChange(option.value)}
            />
            {option.label}
          </OptionLabel>
        ))}
      </OptionGroup>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldContainer>
  );
};
