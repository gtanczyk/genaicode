import { type ServiceConfig } from '../../../ai-service/service-configurations-types.js';
export { type ServiceConfig } from '../../../ai-service/service-configurations-types.js';
import { AiServiceType } from '../../../ai-service/service-configurations-types.js';
import { UsageMetrics } from '../../common/cost-collector.js';

export type Usage = {
  usageMetrics: Record<AiServiceType | 'total', UsageMetrics>;
};

export interface CodegenResult {
  success: boolean;
  message?: string;
}

export type ConfirmationProps =
  | {
      includeAnswer: boolean;
      confirmLabel: string;
      declineLabel: string;
      defaultValue: boolean;
    }
  | undefined;

export interface Question {
  id: string;
  text: string;
  confirmation: ConfirmationProps;
}

/**
 * Sanitized version of ServiceConfig that excludes sensitive data.
 * This interface is safe to expose through the API.
 */
export type SanitizedServiceConfig = {
  /**
   * Model overrides for the service.
   * Allows customizing model names for different modes.
   */
  modelOverrides?: {
    default?: string; // Default model name
    cheap?: string; // Model name for cheap/fast mode
    lite?: string; // Model name for lite mode
    reasoning?: string; // Model name for reasoning mode
    hasModelSpecificSettings?: boolean; // Indicates if model-specific settings exist
  };
} & (
  | {
      /**
       * Indicates whether an API key is configured for this service
       * Only relevant for services that use API keys
       */
      hasApiKey?: boolean;
      googleCloudProjectId?: '';
      googleCloudRegion?: '';
      openaiBaseUrl?: string;
    }
  | {
      hasApiKey: false;
      googleCloudProjectId?: string;
      googleCloudRegion?: string;
      openaiBaseUrl?: '';
    }
);

/**
 * Map of service configurations by service type.
 * This type includes sensitive data and should only be used internally.
 */
export type ServiceConfigurations = {
  [K in AiServiceType]: ServiceConfig<K>;
};

/**
 * Map of sanitized service configurations by service type.
 * This type is safe to expose through the API.
 */
export type SanitizedServiceConfigurations = {
  [K in AiServiceType]: SanitizedServiceConfig;
};

/**
 * Type for updating service configuration.
 * Includes service type and new configuration.
 */
export interface ServiceConfigUpdate<T extends AiServiceType = AiServiceType> {
  serviceType: T;
  config: ServiceConfig<T>;
}

// --- Conversation Graph Types ---

/**
 * Represents a node in the conversation graph.
 */
export interface ConversationGraphNode {
  id: string;
  actionType: string; // Consider importing ActionType if available globally
  instruction: string;
}

/**
 * Represents an edge connecting two nodes in the conversation graph.
 */
export interface ConversationGraphEdge {
  sourceNode: string;
  targetNode: string;
  instruction: string;
}

/**
 * Represents the current state of the conversation graph sent to the frontend.
 */
export interface ConversationGraphState {
  nodes: ConversationGraphNode[];
  edges: ConversationGraphEdge[];
  currentNodeId: string | null; // ID of the currently active node, null if graph not active
  isActive: boolean; // Explicit flag to indicate if graph traversal is active
}
