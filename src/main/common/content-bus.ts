import { ChatMessageFlags, ChatMessageType, ContentProps } from './content-bus-types.js';

type ContentHandler = (content: ContentProps) => void;

let contentHandler: ContentHandler | undefined;
let currentIterationId: string | null;

export function setCurrentIterationId() {
  currentIterationId = Date.now().toString();
}

export function unsetCurrentIterationId() {
  currentIterationId = null;
}

type MessageArgs = [data?: unknown, flags?: ChatMessageFlags[]];

export function putUserMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.USER, ...args);
}

export function putSystemMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.SYSTEM, ...args);
}

export function putAssistantMessage(message: string, ...args: MessageArgs) {
  putMessage(message, ChatMessageType.ASSISTANT, ...args);
}

export function putMessage(message: string, type: ChatMessageType, data?: unknown, flags?: ChatMessageFlags[]) {
  if (!currentIterationId) {
    console.warn('No current iteration ID set');
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
    },
    data,
  });
}

export function registerContentHandler(handler: ContentHandler) {
  contentHandler = handler;
}
