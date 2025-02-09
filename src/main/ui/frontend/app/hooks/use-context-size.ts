import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

/**
 * Formats the context size in a human-readable format
 * @param tokens Number of tokens
 * @returns Formatted string (e.g., "2.5K tokens" or "500 tokens")
 */
export const formatContextSize = (tokens: number): string => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
};

/**
 * Calculates the total context size for an iteration based on assistant messages
 * @param messages Messages in the iteration
 * @returns Total context size or undefined if no context size information is available
 */
export const getIterationContextSize = (messages: ChatMessage[]): number | undefined => {
  const assistantMessages = messages.filter(
    (msg) => msg.type === ChatMessageType.ASSISTANT && typeof msg.data?.contextSize === 'number',
  );
  if (assistantMessages.length === 0) return undefined;

  // Return the context size of the last assistant message in the iteration
  return assistantMessages[assistantMessages.length - 1].data?.contextSize as number | undefined;
};

/**
 * Hook for managing context size calculations and formatting
 * @param messages Array of chat messages
 * @returns Object containing formatted context size and raw token count
 */
export const useContextSize = (messages: ChatMessage[]) => {
  const contextSize = getIterationContextSize(messages);
  const formattedSize = contextSize !== undefined ? formatContextSize(contextSize) : 'Context size N/A';

  return {
    contextSize,
    formattedSize,
  };
};
