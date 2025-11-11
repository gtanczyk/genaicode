import React, { useState } from 'react';
import { StructuredQuestionForm, StructuredQuestionField } from '../../../../../../prompt/steps/step-ask-question/step-ask-question-types';
import { FormField } from './form-field';
import { CheckboxGroup } from './checkbox-group';
import { RadioGroup } from './radio-group';
import { SelectField } from './select-field';
import { FormContainer, FormTitle, FormDescription, ButtonGroup, Button } from './structured-question-styles';

interface StructuredQuestionFormProps {
  form: StructuredQuestionForm;
  onSubmit: (values: Record<string, string | string[] | boolean>) => void;
  onCancel: () => void;
}

export const StructuredQuestionFormComponent: React.FC<StructuredQuestionFormProps> = ({ form, onSubmit, onCancel }) => {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const initialValues: Record<string, any> = {};
    form.fields.forEach(field => {
      initialValues[field.id] = field.defaultValue;
    });
    return initialValues;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (id: string, value: any) => {
    setValues(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[id];
        return newErrors;
      });
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    form.fields.forEach(field => {
      if (field.required && !values[field.id]) {
        newErrors[field.id] = `${field.label} is required.`;
      }
      // Add more complex validation logic here based on field.validation
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(values);
    }
  };

  const renderField = (field: StructuredQuestionField) => {
    switch (field.type) {
      case 'checkbox':
        return <CheckboxGroup key={field.id} field={field} value={values[field.id] || []} onChange={(value) => handleChange(field.id, value)} error={errors[field.id]} />;
      case 'radio':
        return <RadioGroup key={field.id} field={field} value={values[field.id]} onChange={(value) => handleChange(field.id, value)} error={errors[field.id]} />;
      case 'select':
        return <SelectField key={field.id} field={field} value={values[field.id]} onChange={(value) => handleChange(field.id, value)} error={errors[field.id]} />;
      case 'text':
      case 'textarea':
      case 'number':
      case 'email':
      default:
        return <FormField key={field.id} field={field} value={values[field.id]} onChange={(value) => handleChange(field.id, value)} error={errors[field.id]} />;
    }
  };

  return (
    <FormContainer onSubmit={handleSubmit}>
      {form.title && <FormTitle>{form.title}</FormTitle>}
      {form.description && <FormDescription>{form.description}</FormDescription>}
      {form.fields.map(renderField)}
      <ButtonGroup>
        <Button type="submit">{form.submitLabel || 'Submit'}</Button>
        {form.cancelLabel && <Button type="button" onClick={onCancel} data-secondary="true">{form.cancelLabel}</Button>}
      </ButtonGroup>
    </FormContainer>
  );
};
