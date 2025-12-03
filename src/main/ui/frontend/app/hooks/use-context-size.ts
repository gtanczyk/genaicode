import { useCallback, useState } from 'react';
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';
import type { PromptItem } from '../../../../../ai-service/common-types.js';

/**
 * Formats the context size in a human-readable format
 * @param tokens Number of tokens
 * @returns Formatted string (e.g., "2.5K tokens" or "500 tokens")
 */
export const formatContextSize = (tokens: number): string => {
  if (tokens >= 1000) {
    return `Context size: ${(tokens / 1000).toFixed(1)}K tokens`;
  }
  return `Context size: ${tokens} tokens`;
};

/**
 * Formats the context size as a short badge label
 * @param tokens Number of tokens
 * @returns Formatted string (e.g., "2.5K" or "500")
 */
export const formatContextSizeBadge = (tokens: number): string => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return `${tokens}`;
};

/**
 * Calculates the total context size for an iteration based on assistant messages
 * @param messages Messages in the iteration
 * @returns Total context size or undefined if no context size information is available
 */
export const getIterationContextSize = (messages: ChatMessage[]): number | undefined => {
  const assistantMessages = messages.filter(
    (msg) =>
      [ChatMessageType.ASSISTANT, ChatMessageType.SYSTEM].includes(msg.type) &&
      typeof msg.data?.contextSize === 'number',
  );
  if (assistantMessages.length === 0) return undefined;

  // Return the context size of the last assistant message in the iteration
  return assistantMessages[assistantMessages.length - 1].data?.contextSize as number | undefined;
};

/**
 * Calculates the context size based only on files (for context manager badge)
 * This excludes system messages, user messages, and other non-file content
 * @param messages Messages in the iteration
 * @returns Files-only context size or undefined if no information is available
 */
export const getFilesOnlyContextSize = (messages: ChatMessage[]): number | undefined => {
  const assistantMessages = messages.filter(
    (msg) => msg.type === ChatMessageType.SYSTEM && typeof msg.data?.filesContextSize === 'number',
  );
  if (assistantMessages.length === 0) return undefined;

  // Return the files context size of the last assistant message in the iteration
  return assistantMessages[assistantMessages.length - 1].data?.filesContextSize as number | undefined;
};

/**
 * Hook for managing context size calculations and formatting.
 * Now supports fetching the real prompt context from backend for accurate preview.
 *
 * @param messages Array of chat messages
 * @returns Object containing formatted context size, raw token counts, and prompt context utilities
 */
export const useContextSize = (messages: ChatMessage[]) => {
  // Lightweight, message-based sizes for badges (no network request)
  const contextSize = getIterationContextSize(messages);
  const filesOnlyContextSize = getFilesOnlyContextSize(messages);
  const formattedSize = contextSize !== undefined ? formatContextSize(contextSize) : 'Context size N/A';
  const formattedFilesSize =
    filesOnlyContextSize !== undefined ? formatContextSize(filesOnlyContextSize) : 'Files context N/A';

  // Full prompt context for preview (fetched from backend on demand)
  const [promptItems, setPromptItems] = useState<PromptItem[] | null>(null);
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPromptContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // NOTE: Endpoint registered in context-endpoint.ts as router.get('/prompt', ...)
      const resp = await fetch('/api/prompt', { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`Failed to fetch prompt context: ${resp.status} ${resp.statusText}`);
      }
      const data = (await resp.json()) as { promptItems: PromptItem[]; totalTokens: number };
      setPromptItems(data.promptItems ?? []);
      setTotalTokens(typeof data.totalTokens === 'number' ? data.totalTokens : 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error fetching prompt context';
      setError(msg);
      setPromptItems([]);
      setTotalTokens(0);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    // Existing badge-oriented values
    contextSize,
    filesOnlyContextSize,
    formattedSize,
    formattedFilesSize,

    // Full prompt preview values
    promptItems,
    totalTokens,
    loading,
    error,
    refreshPromptContext,
  };
};
