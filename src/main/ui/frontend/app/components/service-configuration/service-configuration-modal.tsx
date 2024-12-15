import React, { useState, useEffect } from 'react';
import { AiServiceType } from '../../../../../codegen-types.js';
import { SanitizedServiceConfigurations, ServiceConfig } from '../../../../common/api-types.js';
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
    <ToggleButton 
      onClick={dispatchServiceConfigurationModalOpen} 
      aria-label="Open service configuration"
    >
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
    <ModalOverlay 
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-config-title"
    >
      <ModalContent>
        <CloseButton 
          onClick={onClose}
          aria-label="Close configuration modal"
        >
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
            {successMessage}
          </SuccessMessage>
        )}

        <ServicesContainer>
          {!configurations ? (
            <div aria-live="polite">Loading...</div>
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