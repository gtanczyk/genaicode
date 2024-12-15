import React, { useState, useEffect } from 'react';
import { AiServiceType } from '../../../../../codegen-types.js';
import { ServiceConfig, SanitizedServiceConfig } from '../../../../common/api-types.js';
import {
  ServiceCard,
  CollapsibleHeader,
  ServiceHeader,
  ServiceName,
  CollapseIndicator,
  CollapsibleContent,
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
  const [isCollapsed, setIsCollapsed] = useState(true);
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

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCollapse();
    }
  };

  return (
    <ServiceCard>
      <CollapsibleHeader
        onClick={toggleCollapse}
        onKeyDown={handleKeyPress}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-controls={`config-content-${serviceType}`}
      >
        <ServiceHeader>
          <ServiceName>{serviceType}</ServiceName>
          {hasApiKey && <span title="API Key is set">🔑</span>}
        </ServiceHeader>
        <CollapseIndicator $isCollapsed={isCollapsed}>▼</CollapseIndicator>
      </CollapsibleHeader>
      
      <CollapsibleContent 
        $isCollapsed={isCollapsed}
        id={`config-content-${serviceType}`}
        aria-hidden={isCollapsed}
      >
        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label htmlFor={`apiKey-${serviceType}`}>API Key</Label>
            <Input
              id={`apiKey-${serviceType}`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? 'API key is set' : 'Enter API key'}
              aria-label={`API Key for ${serviceType}`}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor={`defaultModel-${serviceType}`}>Default Model</Label>
            <Input
              id={`defaultModel-${serviceType}`}
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="Enter model name"
              aria-label={`Default Model for ${serviceType}`}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor={`cheapModel-${serviceType}`}>Cheap Model</Label>
            <Input
              id={`cheapModel-${serviceType}`}
              type="text"
              value={cheapModel}
              onChange={(e) => setCheapModel(e.target.value)}
              placeholder="Enter model name"
              aria-label={`Cheap Model for ${serviceType}`}
            />
          </FormGroup>
          <UpdateButton 
            type="submit" 
            disabled={isLoading}
            aria-busy={isLoading}
          >
            Update Configuration
          </UpdateButton>
        </Form>
      </CollapsibleContent>
    </ServiceCard>
  );
};