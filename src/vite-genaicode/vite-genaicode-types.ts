import type { ConsoleLogLevel, ConsoleLogEntry, ConsoleLogMode } from '../main/common/console-types.js';

/**
 * Event types for cross-window notification communication
 */
export enum NotificationEventType {
  FOCUS = 'GENAICODE_FOCUS',
  BLUR = 'GENAICODE_BLUR',
  NEW_MESSAGES = 'GENAICODE_NEW_MESSAGES',
  RESET_NOTIFICATIONS = 'GENAICODE_RESET_NOTIFICATIONS',
}

/**
 * Payload interface for notification events
 */
export interface NotificationEventPayload {
  count?: number;
  isFocused?: boolean;
  timestamp?: number;
}

/**
 * Type definition for notification postMessage events
 */
export interface NotificationEvent {
  type: NotificationEventType;
  payload: NotificationEventPayload;
  source?: 'genaicode';
  origin?: string;
}

export type { ConsoleLogLevel, ConsoleLogEntry, ConsoleLogMode };
