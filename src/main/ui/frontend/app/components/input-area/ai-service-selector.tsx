import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { AiServiceType } from '../../../../../codegen-types';
import { getAvailableAiServices } from '../../api/api-client';

interface AiServiceSelectorProps {
  value: AiServiceType;
  onChange: (value: AiServiceType) => void;
  disabled?: boolean;
}

export const AiServiceSelector: React.FC<AiServiceSelectorProps> = ({ value, onChange, disabled }) => {
  const [availableServices, setAvailableServices] = useState<AiServiceType[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAiServices = async () => {
      try {
        const services = await getAvailableAiServices();
        setAvailableServices(services);
      } catch (err) {
        console.error('Error fetching AI services:', err);
        setError('Failed to fetch available AI services.');
      }
    };

    fetchAiServices();
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as AiServiceType);
  };

  return (
    <Container>
      <Select id="aiService" value={value} onChange={handleChange} disabled={disabled || error !== null}>
        <option value="">Select AI Service</option>
        {availableServices.map((service) => (
          <option key={service} value={service}>
            {service}
          </option>
        ))}
      </Select>
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

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
`;
