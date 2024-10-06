export enum ChatMessageType {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum ChatMessageFlags {
  CONVERSATION_SUMMARY = 'conversation-summary',
}

export interface ChatMessage {
  id: string;
  iterationId: string;
  type: ChatMessageType;
  flags?: ChatMessageFlags[];
  content: string;
  timestamp: Date;
  data?: unknown;
}

export type ContentProps = {
  message?: ChatMessage;
  data?: unknown;
};
