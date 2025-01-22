import React from 'react';
import styled from 'styled-components';
import { AiServiceType } from '../../../../../codegen-types';
import { useServiceConfigurationsWithModels } from '../../hooks/available-service';

interface AiServiceSelectorProps {
  value: AiServiceType;
  onChange: (value: AiServiceType) => void;
  disabled?: boolean;
}

export const AiServiceSelector: React.FC<AiServiceSelectorProps> = ({ value, onChange, disabled }) => {
  const { services, isLoading, error } = useServiceConfigurationsWithModels();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as AiServiceType);
  };

  return (
    <Container>
      <Select id="aiService" value={value} onChange={handleChange} disabled={disabled || isLoading || error !== null}>
        <option value="">Select AI Service</option>
        {services.map(({ service, displayName }) => (
          <option key={service} value={service}>
            {displayName}
          </option>
        ))}
      </Select>
      {isLoading && <StatusMessage>Loading services...</StatusMessage>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Container>
  );
};

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Select = styled.select`
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 14px;
  max-width: 200px; /* Ensure enough space for longer options */

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
    cursor: not-allowed;
  }

  option {
    padding: 4px;
    background-color: ${({ theme }) => theme.colors.inputBg};
    color: ${({ theme }) => theme.colors.inputText};
  }
`;

const StatusMessage = styled.div`
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  font-style: italic;
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
`;
