import React, { useState, useEffect, useCallback } from 'react';
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
  ValidationMessage,
} from './service-configuration-modal-styles.js';

interface ServiceConfigCardProps {
  serviceType: AiServiceType;
  config?: SanitizedServiceConfig;
  onUpdate: (config: ServiceConfig) => void;
  isLoading: boolean;
  isExpanded?: boolean;
  onCardClick?: (serviceType: AiServiceType) => void;
}

const isVertexService = (serviceType: AiServiceType): boolean => {
  return serviceType === 'vertex-ai' || serviceType === 'vertex-ai-claude';
};

const isVertexClaudeService = (serviceType: AiServiceType): boolean => {
  return serviceType === 'vertex-ai-claude';
};

const isOpenAIApiService = (serviceType: AiServiceType): boolean => {
  return serviceType === 'openai' || serviceType === 'local-llm';
};

export const ServiceConfigCard: React.FC<ServiceConfigCardProps> = ({
  serviceType,
  config,
  onUpdate,
  isLoading,
  isExpanded,
  onCardClick,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(!!config?.hasApiKey);
  const [defaultModel, setDefaultModel] = useState(config?.modelOverrides?.default || '');
  const [cheapModel, setCheapModel] = useState(config?.modelOverrides?.cheap || '');
  const [liteModel, setLiteModel] = useState(config?.modelOverrides?.lite || '');
  const [googleCloudProjectId, setGoogleCloudProjectId] = useState(config?.googleCloudProjectId || '');
  const [googleCloudRegion, setGoogleCloudRegion] = useState(config?.googleCloudRegion || '');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(config?.openaiBaseUrl || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Update local state when config changes
  useEffect(() => {
    setHasApiKey(!!config?.hasApiKey);
    setDefaultModel(config?.modelOverrides?.default || '');
    setCheapModel(config?.modelOverrides?.cheap || '');
    setLiteModel(config?.modelOverrides?.lite || '');
    setGoogleCloudProjectId(config?.googleCloudProjectId || '');
    setGoogleCloudRegion(config?.googleCloudRegion || '');
    setOpenaiBaseUrl(config?.openaiBaseUrl || '');
  }, [config]);

  const validateForm = (): boolean => {
    if (isVertexService(serviceType)) {
      if (!googleCloudProjectId) {
        setValidationError('GCP Project ID is required for Vertex AI services');
        return false;
      }
      if (isVertexClaudeService(serviceType) && !googleCloudRegion) {
        setValidationError('GCP Region is required for Vertex AI Claude');
        return false;
      }
    } else if (!hasApiKey && !apiKey) {
      setValidationError('API Key is required');
      return false;
    }

    setValidationError(null);
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const updatedConfig: ServiceConfig = {
      modelOverrides: {
        default: defaultModel || undefined,
        cheap: cheapModel || undefined,
        lite: liteModel || undefined,
      },
    };

    // Add service-specific configuration
    if (isVertexService(serviceType)) {
      updatedConfig.googleCloudProjectId = googleCloudProjectId;
      if (isVertexClaudeService(serviceType)) {
        updatedConfig.googleCloudRegion = googleCloudRegion;
      }
    } else {
      updatedConfig.apiKey = apiKey || undefined;
      updatedConfig.openaiBaseUrl = openaiBaseUrl || undefined;
    }

    onUpdate(updatedConfig);
  };

  const toggleCollapse = useCallback(() => {
    if (onCardClick) {
      onCardClick(serviceType);
    }
  }, [onCardClick, serviceType]);

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
        aria-expanded={!!isExpanded}
        aria-controls={`config-content-${serviceType}`}
      >
        <ServiceHeader>
          <ServiceName>{serviceType}</ServiceName>
          {!isVertexService(serviceType) && hasApiKey && <span title="API Key is set">🔑</span>}
          {isVertexService(serviceType) && googleCloudProjectId && <span title="GCP Project ID is set">🌐</span>}
        </ServiceHeader>
        <CollapseIndicator $isCollapsed={!isExpanded}>▼</CollapseIndicator>
      </CollapsibleHeader>

      <CollapsibleContent $isCollapsed={!isExpanded} id={`config-content-${serviceType}`} aria-hidden={!isExpanded}>
        <Form onSubmit={handleSubmit}>
          {/* API Key input for non-Vertex services */}
          {!isVertexService(serviceType) && (
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
          )}

          {isOpenAIApiService(serviceType) && (
            // baseUrl input for OpenAI service
            <FormGroup>
              <Label htmlFor={`baseUrl-${serviceType}`}>Base URL</Label>
              <Input
                id={`baseUrl-${serviceType}`}
                type="text"
                value={openaiBaseUrl}
                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                placeholder="Enter base URL"
                aria-label={`Base URL for ${serviceType}`}
              />
            </FormGroup>
          )}

          {/* GCP Project ID for Vertex services */}
          {isVertexService(serviceType) && (
            <FormGroup>
              <Label htmlFor={`projectId-${serviceType}`}>GCP Project ID</Label>
              <Input
                id={`projectId-${serviceType}`}
                type="text"
                value={googleCloudProjectId}
                onChange={(e) => setGoogleCloudProjectId(e.target.value)}
                placeholder="Enter GCP Project ID"
                aria-label={`GCP Project ID for ${serviceType}`}
                required
              />
            </FormGroup>
          )}

          {/* GCP Region for Vertex AI Claude */}
          {isVertexClaudeService(serviceType) && (
            <FormGroup>
              <Label htmlFor={`region-${serviceType}`}>GCP Region</Label>
              <Input
                id={`region-${serviceType}`}
                type="text"
                value={googleCloudRegion}
                onChange={(e) => setGoogleCloudRegion(e.target.value)}
                placeholder="Enter GCP Region"
                aria-label={`GCP Region for ${serviceType}`}
                required
              />
            </FormGroup>
          )}

          {/* Model configuration fields */}
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
          <FormGroup>
            <Label htmlFor={`liteModel-${serviceType}`}>Lite Model</Label>
            <Input
              id={`liteModel-${serviceType}`}
              type="text"
              value={liteModel}
              onChange={(e) => setLiteModel(e.target.value)}
              placeholder="Enter model name"
              aria-label={`Lite Model for ${serviceType}`}
            />
          </FormGroup>

          {validationError && (
            <ValidationMessage role="alert" aria-live="polite">
              {validationError}
            </ValidationMessage>
          )}

          <UpdateButton type="submit" disabled={isLoading} aria-busy={isLoading}>
            {isLoading ? 'Updating...' : 'Update Configuration'}
          </UpdateButton>
        </Form>
      </CollapsibleContent>
    </ServiceCard>
  );
};
