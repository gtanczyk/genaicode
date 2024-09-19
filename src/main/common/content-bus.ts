import { ChatMessageType, ContentProps } from './content-bus-types.js';

type ContentHandler = (content: ContentProps) => void;

let contentHandler: ContentHandler | undefined;

export function putUserMessage(message: string) {
  putMessage(message, ChatMessageType.USER);
}

export function putSystemMessage(message: string, data?: unknown) {
  putMessage(message, ChatMessageType.SYSTEM, data);
}

export function putAssistantMessage(message: string, data?: unknown) {
  putMessage(message, ChatMessageType.ASSISTANT, data);
}

export function putMessage(message: string, type: ChatMessageType, data?: unknown) {
  console.log(message, data);

  contentHandler?.({
    message: { id: (Date.now() + Math.random()).toString(), content: message, type: type, timestamp: new Date() },
    data,
  });
}

export function putContent(content: ContentProps) {
  contentHandler?.(content);
}

export function registerContentHandler(handler: ContentHandler) {
  contentHandler = handler;
}
