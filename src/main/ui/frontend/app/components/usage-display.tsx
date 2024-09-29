import React, { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { AiServiceType } from '../../../../codegen-types.js';
import { Usage } from '../api/api-types.js';

interface UsageDisplayProps {
  usage: Usage;
}

export const UsageDisplay: React.FC<UsageDisplayProps> = ({ usage }) => {
  const [selectedService, setSelectedService] = useState<AiServiceType | 'total'>('total');

  const handleServiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedService(event.target.value as AiServiceType | 'total');
  };

  const usageMetrics = usage.usageMetrics[selectedService];
  const displayCost = usage.usageMetrics[selectedService].cost || 0;

  const animatedCost = useAnimatedValue(displayCost.toFixed(2));
  const animatedRPM = useAnimatedValue(usageMetrics.rpm);
  const animatedRPD = useAnimatedValue(usageMetrics.rpd);
  const animatedTPM = useAnimatedValue(formatNumber(usageMetrics.tpm));
  const animatedTPD = useAnimatedValue(formatNumber(usageMetrics.tpd));

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
          <AnimatedMetricValue key={animatedCost}>${animatedCost}</AnimatedMetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>RPM:</MetricLabel>
          <AnimatedMetricValue key={animatedRPM}>{animatedRPM}</AnimatedMetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>RPD:</MetricLabel>
          <AnimatedMetricValue key={animatedRPD}>{animatedRPD}</AnimatedMetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>TPM:</MetricLabel>
          <AnimatedMetricValue key={animatedTPM}>{animatedTPM}</AnimatedMetricValue>
        </MetricItem>
        <MetricItem>
          <MetricLabel>TPD:</MetricLabel>
          <AnimatedMetricValue key={animatedTPD}>{animatedTPD}</AnimatedMetricValue>
        </MetricItem>
      </MetricsGrid>
    </UsageContainer>
  );
};

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

// Custom hook to manage animated value
const useAnimatedValue = (value: string | number) => {
  const [animatedValue, setAnimatedValue] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      setAnimatedValue(value);
      prevValueRef.current = value;
    }
  }, [value]);

  return animatedValue;
};

// Keyframe animation for value change
const valueChangeAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const UsageContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: 4px;
  padding: 8px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.24);
`;

const MetricsGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const Select = styled.select`
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
  margin-left: 8px;
`;

const MetricLabel = styled.span`
  font-size: 0.8em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const AnimatedMetricValue = styled.span`
  font-size: 0.9em;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
  animation: ${valueChangeAnimation} 0.5s ease-in-out;
`;
