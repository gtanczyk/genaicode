import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

// Updated PromptItem to include 'system' role
type PromptItem = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

// New interface for the language model session
interface LanguageModelSession {
  prompt(text: string): Promise<string>;
}

/**
 * Creates a new AI session using the browser's built-in language model.
 * @param initialPrompts - The initial prompts to seed the conversation.
 * @returns The initialized session object or null if creation fails.
 */
async function createAiSession(initialPrompts: PromptItem[]): Promise<LanguageModelSession | null> {
  try {
    // Type definition for the new window.ai API
    const LanguageModel = (
      window as Window & {
        LanguageModel?: {
          create?: (opts: { initialPrompts: PromptItem[] }) => Promise<LanguageModelSession | null>;
        };
      }
    ).LanguageModel;

    if (!LanguageModel || typeof LanguageModel.create !== 'function') {
      console.warn('Browser AI API (window.ai.languageModel.create) not available.');
      return null;
    }

    const session = await LanguageModel.create({
      initialPrompts,
    });
    return session;
  } catch (error) {
    console.error('Failed to create browser AI session:', error);
    return null;
  }
}

/**
 * Generates suggestions based on the conversation context using the browser AI model.
 * @param conversationContext An array of ChatMessage objects representing the recent conversation.
 * @returns A promise that resolves to an array of suggestion strings, or an empty array on failure.
 */
export async function generateSuggestions(conversationContext: ChatMessage[]): Promise<string[]> {
  // This feature is only available in genaicode development mode
  if (!import.meta.env.DEV || !conversationContext || conversationContext.length === 0) {
    return [];
  }

  const lastMessage = conversationContext[conversationContext.length - 1];
  // We only want to generate suggestions for the user's messages
  if (lastMessage.type !== ChatMessageType.ASSISTANT) {
    return [];
  }

  const initialPrompts: PromptItem[] = [
    {
      role: 'system',
      content: `You are a helpful assistant. The user will provide a conversation history.
Your task is to provide a few concise, relevant suggestions for a reply based on the last message in the conversation.
Provide only the suggestions, separated by newlines. Each suggestion should be a few words long. Do not prefix with numbers or dashes.`,
    },
  ];

  // Map ChatMessage to PromptItem
  for (const message of conversationContext) {
    if (message.type === ChatMessageType.USER) {
      initialPrompts.push({
        role: 'user',
        content: message.content,
      });
    } else if (message.type === ChatMessageType.ASSISTANT) {
      initialPrompts.push({
        role: 'assistant',
        content: message.content,
      });
    }
  }

  const session = await createAiSession(initialPrompts);
  if (!session) {
    return [];
  }

  try {
    // The session is already primed with the context.
    // This prompt now asks the model to perform its main task.
    const response = await session.prompt('What are some possible replies?');

    if (!response) {
      return [];
    }

    // Parse the response into an array of suggestions
    const suggestions = response
      .split('\n')
      .map((s) => s.trim().replace(/^- /, '')) // Also remove leading dash
      .filter((s) => s.length > 0);

    return suggestions.slice(0, 5); // Limit to 5 suggestions
  } catch (error) {
    console.error('Failed to generate suggestions using browser AI session:', error);
    return [];
  }
}
