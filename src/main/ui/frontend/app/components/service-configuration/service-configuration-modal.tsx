import React, { useState, useEffect } from 'react';
import { AiServiceType } from '../../../../../codegen-types.js';
import { SanitizedServiceConfigurations, ServiceConfig, ServiceConfigUpdate } from '../../../../common/api-types.js';
import { getServiceConfigurations, updateServiceConfiguration } from '../../api/api-client.js';
import { dispatchCustomEvent, useCustomEvent } from '../../hooks/custom-events.js';
import { useAvailableServices } from '../../hooks/available-service.js';
import { ToggleButton } from '../toggle-button.js';
import { ServiceConfigCard } from './service-config-card.js';
import {
  ModalOverlay,
  ModalContent,
  ModalHeader,
  CloseButton,
  ServicesContainer,
  ErrorMessage,
  SuccessMessage,
  LoadingOverlay,
} from './service-configuration-modal-styles.js';

export function dispatchServiceConfigurationModalOpen() {
  dispatchCustomEvent('openServiceConfigurationModal');
}

export function ServiceConfigurationIcon() {
  return (
    <ToggleButton onClick={dispatchServiceConfigurationModalOpen} aria-label="Open service configuration">
      ⚙️
    </ToggleButton>
  );
}

// Helper function to determine if a service is a Vertex AI service
const isVertexService = (serviceType: AiServiceType): boolean => {
  return serviceType === 'vertex-ai' || serviceType === 'vertex-ai-claude';
};

// Helper function to generate appropriate success message
const getSuccessMessage = (serviceType: AiServiceType, config: ServiceConfig): string => {
  const messages: string[] = ['Configuration updated successfully for ' + serviceType];

  if (isVertexService(serviceType)) {
    if (config.googleCloudProjectId) {
      messages.push(`GCP Project ID: ${config.googleCloudProjectId}`);
    }
    if (serviceType === 'vertex-ai-claude' && config.googleCloudRegion) {
      messages.push(`GCP Region: ${config.googleCloudRegion}`);
    }
  } else if (config.apiKey) {
    messages.push('API key has been updated');
  }

  if (config.modelOverrides?.default) {
    messages.push(`Default model: ${config.modelOverrides.default}`);
  }
  if (config.modelOverrides?.cheap) {
    messages.push(`Cheap model: ${config.modelOverrides.cheap}`);
  }

  return messages.join('\n');
};

// Helper function to validate service configuration
const validateServiceConfig = (serviceType: AiServiceType, config: ServiceConfig): string | null => {
  if (isVertexService(serviceType)) {
    if (!config.googleCloudProjectId) {
      return `GCP Project ID is required for ${serviceType}`;
    }
    if (serviceType === 'vertex-ai-claude' && !config.googleCloudRegion) {
      return 'GCP Region is required for Vertex AI Claude';
    }
  }
  return null;
};

export const ServiceConfigurationModal: React.FC = () => {
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [configurations, setConfigurations] = useState<SanitizedServiceConfigurations | undefined>();
  const [availableServices] = useAvailableServices();

  useCustomEvent('openServiceConfigurationModal', () => setOpen(true));

  const onClose = () => {
    setOpen(false);
    setError(null);
    setSuccessMessage(null);
  };

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

    // Validate configuration
    const validationError = validateServiceConfig(serviceType, config);
    if (validationError) {
      setError(validationError);
      setIsLoading(false);
      return;
    }

    try {
      const update: ServiceConfigUpdate = {
        serviceType,
        config,
      };

      await updateServiceConfiguration(update);
      await fetchConfigurations(); // Refresh configurations
      setSuccessMessage(getSuccessMessage(serviceType, config));
    } catch (err) {
      let errorMessage = 'Failed to update configuration';
      if (err instanceof Error) {
        errorMessage = err.message;
        // Add more context for specific errors
        if (err.message.includes('auth')) {
          errorMessage = `Authentication error for ${serviceType}: ${err.message}`;
        } else if (err.message.includes('permission')) {
          errorMessage = `Permission error for ${serviceType}: ${err.message}`;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-config-title"
    >
      <ModalContent>
        <CloseButton onClick={onClose} aria-label="Close configuration modal">
          &times;
        </CloseButton>
        <ModalHeader>
          <h2 id="service-config-title">AI Services Configuration</h2>
        </ModalHeader>

        {error && (
          <ErrorMessage role="alert" aria-live="polite">
            {error}
          </ErrorMessage>
        )}
        {successMessage && (
          <SuccessMessage role="status" aria-live="polite">
            {successMessage.split('\n').map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </SuccessMessage>
        )}

        <ServicesContainer>
          {!configurations ? (
            <div aria-live="polite">Loading configurations...</div>
          ) : (
            availableServices.map((serviceType) => (
              <ServiceConfigCard
                key={serviceType}
                serviceType={serviceType}
                config={configurations[serviceType]}
                onUpdate={(config) => handleUpdate(serviceType, config)}
                isLoading={isLoading}
              />
            ))
          )}
        </ServicesContainer>

        {isLoading && (
          <LoadingOverlay role="status" aria-live="polite">
            Updating configurations...
          </LoadingOverlay>
        )}
      </ModalContent>
    </ModalOverlay>
  );
};
