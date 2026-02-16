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
  executableCode?: {
    language: string;
    code: string;
  };
  codeExecutionResult?: {
    outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
    output: string;
    outputFiles?: Array<{
      fileId: string;
      filename: string;
      size: number;
      mimeType?: string;
    }>;
  };
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export interface TerminalEvent {
  id: string;
  iterationId: string;
  level: LogLevel;
  source: 'docker' | 'container-task' | 'command' | 'copy' | 'system';
  text: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export type ContentProps =
  | {
      message: ChatMessage;
      terminalEvent?: never;
      data?: unknown;
      promptItem?: PromptItem;
    }
  | {
      message?: never;
      terminalEvent: TerminalEvent;
      data?: unknown;
      promptItem?: never;
    };
