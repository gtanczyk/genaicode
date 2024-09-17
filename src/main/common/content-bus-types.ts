export enum ChatMessageType {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  content: string;
  timestamp: Date;
  data?: unknown;
}

export type ContentProps = {
  message?: ChatMessage;
  data?: unknown;
};
