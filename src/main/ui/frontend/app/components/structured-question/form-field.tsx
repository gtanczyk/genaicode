import React from 'react';
import { StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types.js';
import { Input, Textarea, FieldContainer, Label, ErrorMessage } from './structured-question-styles';

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
        return <Textarea {...commonProps} rows={4} />;
      case 'number':
      case 'email':
      case 'text':
      default:
        return <Input type={type} {...commonProps} />;
    }
  };

  return (
    <FieldContainer>
      <Label htmlFor={id}>
        {label}
        {required && <span style={{ color: 'var(--error-color, #f44336)', marginLeft: '4px' }}>*</span>}
      </Label>
      {renderInput()}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldContainer>
  );
};
