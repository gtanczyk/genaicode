import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { dispatchCustomEvent, useCustomEvent } from '../hooks/custom-events.js';
import { ToggleButton } from './toggle-button.js';
import { AiServiceType } from '../../../../codegen-types.js';
import { generateContent, getAvailableAiServices } from '../api/api-client.js';
import { FunctionCall } from '../../../../../ai-service/common.js';

export function dispatchHealthCheckModalOpen() {
  dispatchCustomEvent('openHealthCheckModal');
}

export function HealthCheckIcon() {
  return (
    <ToggleButton onClick={dispatchHealthCheckModalOpen} aria-label="Health check modal">
      🏥
    </ToggleButton>
  );
}

type HealthCheckStatus = 'success' | 'error' | 'not_configured' | undefined;

interface HealthCheckServiceStatus {
  status: HealthCheckStatus;
  error?: string;
  lastChecked: string;
  responseTime?: number;
}

interface HealthCheckResponse {
  services: Record<AiServiceType, HealthCheckServiceStatus>;
  timestamp: string;
}

async function startHealthCheck(): Promise<HealthCheckResponse> {
  const services = (await getAvailableAiServices()).map((service) => {
    return [service, { status: undefined, lastChecked: new Date().toISOString() }];
  });
  return { services: Object.fromEntries(services), timestamp: new Date().toISOString() };
}

async function testService(serviceName: AiServiceType) {
  try {
    const [content] = (await generateContent('say: hello', 0.7, true, {
      aiService: serviceName,
      askQuestion: false,
    })) as FunctionCall<{ message?: string }>[];

    return content?.args?.message?.toLowerCase().includes('hello') ? 'success' : undefined;
  } catch {
    return 'error';
  }
}

export const HealthCheckModal: React.FC = () => {
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useCustomEvent('openHealthCheckModal', () => setOpen(true));

  const onClose = () => setOpen(false);

  const fetchHealthStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await startHealthCheck();
      setHealthData(response);
      setLastUpdated(new Date());

      for (const [serviceName, serviceData] of Object.entries(response.services)) {
        const testStart = Date.now();
        const serviceStatus = await testService(serviceName as AiServiceType);

        // Simulate a random response time between 100ms and 500ms
        serviceData.status = serviceStatus;
        serviceData.responseTime = Date.now() - testStart;
        serviceData.lastChecked = new Date().toISOString();

        setHealthData(response);
        setLastUpdated(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealthStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusIcon = (status: HealthCheckServiceStatus['status']) => {
    switch (status) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'not_configured':
        return '⚠️';
      default:
        return '❓';
    }
  };

  const getStatusColor = (status: HealthCheckServiceStatus['status']) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'not_configured':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <ModalOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ModalContent>
        <CloseButton onClick={onClose}>&times;</CloseButton>
        <ModalHeader>
          <h2>AI Services Health Check</h2>
          <RefreshButton onClick={fetchHealthStatus} disabled={isLoading}>
            {isLoading ? 'Checking...' : '🔄 Refresh'}
          </RefreshButton>
        </ModalHeader>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <ServicesContainer>
          {healthData &&
            Object.entries(healthData.services).map(([service, status]) => (
              <ServiceCard key={service}>
                <ServiceHeader>
                  <ServiceName>{service}</ServiceName>
                  <StatusIcon>{getStatusIcon(status.status)}</StatusIcon>
                </ServiceHeader>
                <ServiceDetails color={getStatusColor(status.status)}>
                  <div>Status: {status.status}</div>
                  {status.responseTime && <div>Response time: {status.responseTime}ms</div>}
                  {status.error && <ErrorText>{status.error}</ErrorText>}
                  <LastChecked>Last checked: {new Date(status.lastChecked).toLocaleTimeString()}</LastChecked>
                </ServiceDetails>
              </ServiceCard>
            ))}
        </ServicesContainer>

        {lastUpdated && <LastUpdatedText>Last updated: {lastUpdated.toLocaleTimeString()}</LastUpdatedText>}

        {isLoading && <LoadingOverlay>Checking AI Services...</LoadingOverlay>}
      </ModalContent>
    </ModalOverlay>
  );
};

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: ${({ theme }) => theme.colors.background};
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;

  h2 {
    margin: 0;
  }
`;

const CloseButton = styled.button`
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.text};
  &:hover {
    opacity: 0.8;
  }
`;

const RefreshButton = styled.button`
  padding: 0.5rem 1rem;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ServicesContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
`;

const ServiceCard = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 1rem;
  background: ${({ theme }) => theme.colors.backgroundSecondary};
`;

const ServiceHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
`;

const ServiceName = styled.h3`
  margin: 0;
  font-size: 1.1rem;
`;

const StatusIcon = styled.span`
  font-size: 1.2rem;
`;

const ServiceDetails = styled.div<{ color: string }>`
  color: ${({ theme, color }) => {
    switch (color) {
      case 'success':
        return theme.colors.success;
      case 'error':
        return theme.colors.error;
      case 'warning':
        return theme.colors.warning;
      default:
        return theme.colors.text;
    }
  }};
  font-size: 0.9rem;
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.error};
  margin-top: 0.5rem;
`;

const LastChecked = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.8rem;
  margin-top: 0.5rem;
`;

const LastUpdatedText = styled.div`
  text-align: right;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.8rem;
  margin-top: 1rem;
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  margin-bottom: 1rem;
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.error};
  border-radius: 4px;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 8px;
  color: white;
  font-size: 1.2rem;
`;
