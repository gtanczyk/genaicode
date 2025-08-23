import { PromptItem } from '../../ai-service/common-types.js';
import {
  ChatMessageFlags,
  ChatMessageType,
  ContentProps,
  ChatMessageImage,
  LogLevel,
  TerminalEvent,
} from './content-bus-types.js';

type ContentHandler = (content: ContentProps) => void;

let contentHandler: ContentHandler | undefined;
let currentIterationId: string | null;

export function setCurrentIterationId() {
  currentIterationId = Date.now().toString();
}

export function unsetCurrentIterationId() {
  currentIterationId = null;
}

type MessageArgs = [data?: unknown, flags?: ChatMessageFlags[], images?: ChatMessageImage[], promptItem?: PromptItem];

export function putUserMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.USER, ...args);
}

export function putSystemMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.SYSTEM, ...args);
}

export function putAssistantMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.ASSISTANT, ...args);
}

export function putTerminalEvent(
  level: LogLevel,
  text: string,
  data?: unknown,
  source: TerminalEvent['source'] = 'system',
) {
  if (!currentIterationId) {
    console.warn('No current iteration ID set for terminal event');
  }

  console.log(`[${level.toUpperCase()}] ${text}`, data);

  const terminalEvent: TerminalEvent = {
    id: (Date.now() + Math.random()).toString(),
    iterationId: currentIterationId!,
    level,
    source,
    text,
    timestamp: new Date(),
    data: data as Record<string, unknown> | undefined,
  };

  contentHandler?.({
    terminalEvent,
    data,
  });
}

export function putContainerLog(
  level: LogLevel,
  text: string,
  data?: unknown,
  source: TerminalEvent['source'] = 'container-task',
) {
  putTerminalEvent(level, text, data, source);
}

function putMessage(
  message: string,
  type: ChatMessageType,
  data?: unknown,
  flags?: ChatMessageFlags[],
  images?: ChatMessageImage[],
  promptItem?: PromptItem,
) {
  if (!currentIterationId) {
    console.warn('No current iteration ID set');
  }

  if (promptItem) {
    flags = [...(flags ?? []), ChatMessageFlags.MESSAGE_EDITABLE];
  }

  console.log(message, data);

  contentHandler?.({
    message: {
      id: (Date.now() + Math.random()).toString(),
      iterationId: currentIterationId!,
      content: message,
      type: type,
      flags,
      timestamp: new Date(),
      data: data as Record<string, unknown>,
      images,
    },
    data,
    promptItem,
  });
}
export function editMessage(content: ContentProps, newContent: string) {
  if (content.message && content.promptItem) {
    content.message.content = newContent;
    content.promptItem.text = newContent;
    return true;
  } else {
    return false;
  }
}

export function registerContentHandler(handler: ContentHandler) {
  contentHandler = handler;
}
