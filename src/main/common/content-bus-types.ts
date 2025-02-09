import { PromptItem } from '../../ai-service/common-types.js';

export enum ChatMessageType {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum ChatMessageFlags {
  CONVERSATION_SUMMARY = 'conversation-summary',
  MESSAGE_EDITABLE = 'editable',
}

export interface ChatMessageImage {
  base64url: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  originalName?: string;
}

export interface ChatMessage {
  id: string;
  iterationId: string;
  type: ChatMessageType;
  flags?: ChatMessageFlags[];
  content: string;
  timestamp: Date;
  data?: Record<string, unknown>;
  images?: ChatMessageImage[];
}

export type ContentProps = {
  message?: ChatMessage;
  data?: unknown;
  promptItem?: PromptItem;
};
