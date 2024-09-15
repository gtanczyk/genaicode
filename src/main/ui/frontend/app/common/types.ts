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
}

export interface CodegenExecution {
  id: string;
  prompt: string;
  output: string;
  timestamp: Date;
  cost: number;
}
