import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { AiServiceType } from '../../../../codegen-types.js';
import { SanitizedServiceConfigurations, SanitizedServiceConfig, ServiceConfig } from '../../../common/api-types.js';
import { getServiceConfigurations, updateServiceConfiguration } from '../api/api-client.js';
import { dispatchCustomEvent, useCustomEvent } from '../hooks/custom-events.js';
import { useAvailableServices } from '../hooks/available-service.js';
import { ToggleButton } from './toggle-button.js';

export function dispatchServiceConfigurationModalOpen() {
  dispatchCustomEvent('openServiceConfigurationModal');
}

export function ServiceConfigurationIcon() {
  return (
    <ToggleButton onClick={dispatchServiceConfigurationModalOpen} aria-label="Service configuration modal">
      ⚙️
    </ToggleButton>
  );
}

export const ServiceConfigurationModal: React.FC = () => {
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [configurations, setConfigurations] = useState<SanitizedServiceConfigurations | undefined>();
  const [availableServices] = useAvailableServices();

  useCustomEvent('openServiceConfigurationModal', () => setOpen(true));

  const onClose = () => setOpen(false);

  // Fetch current configurations when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchConfigurations();
    }
  }, [isOpen]);

  const fetchConfigurations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const configs = await getServiceConfigurations();
      setConfigurations(configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch configurations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (serviceType: AiServiceType, config: ServiceConfig) => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await updateServiceConfiguration({ serviceType, config });
      await fetchConfigurations(); // Refresh configurations to get masked API key
      setSuccessMessage(`Configuration for ${serviceType} updated successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update configuration');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ModalContent>
        <CloseButton onClick={onClose}>&times;</CloseButton>
        <ModalHeader>
          <h2>AI Services Configuration</h2>
        </ModalHeader>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {successMessage && <SuccessMessage>{successMessage}</SuccessMessage>}

        <ServicesContainer>
          {!configurations
            ? 'Loading...'
            : availableServices.map((serviceType) => (
                <ServiceConfigCard
                  key={serviceType}
                  serviceType={serviceType}
                  config={configurations[serviceType]}
                  onUpdate={(config) => handleUpdate(serviceType, config)}
                  isLoading={isLoading}
                />
              ))}
        </ServicesContainer>

        {isLoading && <LoadingOverlay>Updating configurations...</LoadingOverlay>}
      </ModalContent>
    </ModalOverlay>
  );
};

interface ServiceConfigCardProps {
  serviceType: AiServiceType;
  config?: SanitizedServiceConfig;
  onUpdate: (config: ServiceConfig) => void;
  isLoading: boolean;
}

const ServiceConfigCard: React.FC<ServiceConfigCardProps> = ({ serviceType, config, onUpdate, isLoading }) => {
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(!!config?.hasApiKey);
  const [defaultModel, setDefaultModel] = useState(config?.modelOverrides?.default || '');
  const [cheapModel, setCheapModel] = useState(config?.modelOverrides?.cheap || '');

  // Update local state when config changes
  useEffect(() => {
    setHasApiKey(!!config?.hasApiKey);
    setDefaultModel(config?.modelOverrides?.default || '');
    setCheapModel(config?.modelOverrides?.cheap || '');
  }, [config]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const updatedConfig: ServiceConfig = {
      apiKey: apiKey || undefined,
      modelOverrides: {
        default: defaultModel || undefined,
        cheap: cheapModel || undefined,
      },
    };

    onUpdate(updatedConfig);
  };

  return (
    <ServiceCard>
      <ServiceHeader>
        <ServiceName>{serviceType}</ServiceName>
      </ServiceHeader>
      <Form onSubmit={handleSubmit}>
        <FormGroup>
          <Label>API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? 'API key is set' : 'Enter API key'}
          />
        </FormGroup>
        <FormGroup>
          <Label>Default Model</Label>
          <Input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="Enter model name"
          />
        </FormGroup>
        <FormGroup>
          <Label>Cheap Model</Label>
          <Input
            type="text"
            value={cheapModel}
            onChange={(e) => setCheapModel(e.target.value)}
            placeholder="Enter model name"
          />
        </FormGroup>
        <UpdateButton type="submit" disabled={isLoading}>
          Update Configuration
        </UpdateButton>
      </Form>
    </ServiceCard>
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
  margin-bottom: 1rem;
`;

const ServiceName = styled.h3`
  margin: 0;
  font-size: 1.1rem;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.text};
`;

const Input = styled.input`
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 0.9rem;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const UpdateButton = styled.button`
  padding: 0.5rem 1rem;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  margin-bottom: 1rem;
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.error};
  border-radius: 4px;
`;

const SuccessMessage = styled.div`
  color: ${({ theme }) => theme.colors.success};
  margin-bottom: 1rem;
  padding: 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.success};
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
