import { ChatMessageType, ContentProps } from './content-bus-types.js';

type ContentHandler = (content: ContentProps) => void;

let contentHandler: ContentHandler;

export function putUserMessage(message: string) {
  putMessage(message, ChatMessageType.USER);
}

export function putSystemMessage(message: string) {
  putMessage(message, ChatMessageType.SYSTEM);
}

export function putAssistantMessage(message: string) {
  putMessage(message, ChatMessageType.ASSISTANT);
}

export function putMessage(message: string, type: ChatMessageType) {
  console.log(message);

  contentHandler({
    message: { id: (Date.now() + Math.random()).toString(), content: message, type: type, timestamp: new Date() },
  });
}

export function putContent(content: ContentProps) {
  contentHandler(content);
}

export function registerContentHandler(handler: ContentHandler) {
  contentHandler = handler;
}
