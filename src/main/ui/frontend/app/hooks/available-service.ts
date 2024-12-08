import { useEffect, useState } from 'react';
import { AiServiceType } from '../../../../codegen-types';
import { getAvailableAiServices } from '../api/api-client';

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
