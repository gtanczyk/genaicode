import styled from 'styled-components';

export const FormContainer = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background-color: ${({ theme }) => theme.colors.background};
`;

export const FormTitle = styled.h3`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

export const FormDescription = styled.p`
  margin: 0 0 8px 0;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

export const FieldContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const Label = styled.label`
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;

export const Input = styled.input`
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 1rem;
`;

export const Textarea = styled.textarea`
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 1rem;
  resize: vertical;
  min-height: 80px;
`;

export const Select = styled.select`
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.inputBorder};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 1rem;
`;

export const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const OptionLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
`;

export const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
`;

export const Button = styled.button`
  padding: 10px 16px;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;

  &.primary {
    background-color: ${({ theme }) => theme.colors.primary};
    color: white;
  }

  &.secondary {
    background-color: ${({ theme }) => theme.colors.secondary};
    color: white;
  }
`;

export const ErrorMessage = styled.p`
  color: ${({ theme }) => theme.colors.error};
  font-size: 0.875rem;
  margin: -4px 0 0 0;
`;
