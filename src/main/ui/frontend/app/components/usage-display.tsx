import React, { useState } from 'react';
import styled from 'styled-components';
import { AiServiceType } from '../../../../codegen-types.js';
import { Usage } from '../api/api-types.js';

interface UsageDisplayProps {
  usage: Usage;
}

// Utility function to format numbers
const formatNumber = (value: number): string => {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1) + 'M';
  } else if (value >= 1_000) {
    return (value / 1_000).toFixed(0) + 'K';
  } else {
    return value.toString();
  }
};

export const UsageDisplay: React.FC<UsageDisplayProps> = ({ usage }) => {
  const [selectedService, setSelectedService] = useState<AiServiceType | 'total'>('total');

  const handleServiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedService(event.target.value as AiServiceType | 'total');
  };

  const usageMetrics = usage.usageMetrics[selectedService];
  const displayCost = usage.usageMetrics[selectedService].cost || 0;

  return (
    <UsageContainer>
      <MetricsGrid>
        <Select onChange={handleServiceChange} value={selectedService}>
          {Object.keys(usage.usageMetrics).map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </Select>
        <MetricItem>
          <MetricLabel>Cost:</MetricLabel>
          <MetricValue>${displayCost.toFixed(2)}</MetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>RPM:</MetricLabel>
          <MetricValue>{usageMetrics.rpm}</MetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>RPD:</MetricLabel>
          <MetricValue>{usageMetrics.rpd}</MetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>TPM:</MetricLabel>
          <MetricValue>{formatNumber(usageMetrics.tpm)}</MetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>TPD:</MetricLabel>
          <MetricValue>{formatNumber(usageMetrics.tpd)}</MetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>IPM:</MetricLabel>
          <MetricValue>{usageMetrics.ipm}</MetricValue>
        </MetricItem>
      </MetricsGrid>
    </UsageContainer>
  );
};

const UsageContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: 4px;
  padding: 8px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.24);
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
`;

const Select = styled.select`
  margin-right: 0px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 0.9em;
`;

const MetricItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const MetricLabel = styled.span`
  font-size: 0.8em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const MetricValue = styled.span`
  font-size: 0.9em;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;
