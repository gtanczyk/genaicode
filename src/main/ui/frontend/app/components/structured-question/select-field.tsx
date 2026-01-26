import React from 'react';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-iterate/step-iterate-types.js';
import { FieldContainer, Label, Select, ErrorMessage } from './structured-question-styles';

interface SelectFieldProps {
  field: StructuredQuestionField;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export const SelectField: React.FC<SelectFieldProps> = ({ field, value, onChange, error }) => {
  return (
    <FieldContainer>
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span style={{ color: 'var(--error-color, #f44336)', marginLeft: '4px' }}>*</span>}
      </Label>
      <Select
        id={field.id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      >
        {field.placeholder && <option value="">{field.placeholder}</option>}
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldContainer>
  );
};
