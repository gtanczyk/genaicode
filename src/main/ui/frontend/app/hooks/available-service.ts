import { useEffect, useState } from 'react';
import { AiServiceType } from '../../../../codegen-types';
import { getAvailableAiServices, getServiceConfigurations } from '../api/api-client';
import { SanitizedServiceConfig } from '../../../common/api-types';

export interface ServiceWithModels {
  service: AiServiceType;
  config?: SanitizedServiceConfig;
  displayName: string;
}

interface ServiceConfigurationState {
  services: ServiceWithModels[];
  isLoading: boolean;
  error: string | null;
}

// Format the display name to include model information
function formatServiceDisplayName(service: AiServiceType, config?: SanitizedServiceConfig): string {
  if (!config?.modelOverrides) {
    return service;
  }

  const models: string[] = [];
  if (config.modelOverrides.default) {
    models.push(config.modelOverrides.default);
  }
  if (config.modelOverrides.cheap) {
    models.push(config.modelOverrides.cheap);
  }

  return models.length > 0 ? `${service} (${models.join('/')})` : service;
}

// Keep the original hook for backward compatibility
export function useAvailableServices() {
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

  return [availableServices, error] as const;
}

// New hook that combines service availability with configurations
export function useServiceConfigurationsWithModels(): ServiceConfigurationState {
  const [state, setState] = useState<ServiceConfigurationState>({
    services: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const fetchServicesWithConfigurations = async () => {
      try {
        // Fetch both services and configurations in parallel
        const [services, configurations] = await Promise.all([getAvailableAiServices(), getServiceConfigurations()]);

        const servicesWithModels: ServiceWithModels[] = services.map((service) => ({
          service,
          config: configurations[service],
          displayName: formatServiceDisplayName(service, configurations[service]),
        }));

        setState({
          services: servicesWithModels,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        console.error('Error fetching services with configurations:', err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Failed to fetch service configurations.',
        }));
      }
    };

    fetchServicesWithConfigurations();
  }, []);

  return state;
}
