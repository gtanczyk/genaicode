import React, { useState, useEffect } from 'react';
import { AiServiceType } from '../../../../../codegen-types.js';
import { ServiceConfig, SanitizedServiceConfig } from '../../../../common/api-types.js';
import {
  ServiceCard,
  ServiceHeader,
  ServiceName,
  Form,
  FormGroup,
  Label,
  Input,
  UpdateButton,
} from './service-configuration-modal-styles.js';

interface ServiceConfigCardProps {
  serviceType: AiServiceType;
  config?: SanitizedServiceConfig;
  onUpdate: (config: ServiceConfig) => void;
  isLoading: boolean;
}

export const ServiceConfigCard: React.FC<ServiceConfigCardProps> = ({ 
  serviceType, 
  config, 
  onUpdate, 
  isLoading 
}) => {
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