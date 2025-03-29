// Define the interface for the browser AI model based on the example usage
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

type PromptItem = {
  role: 'user' | 'assistant';
  content: string;
};

interface BrowserAIModel {
  prompt(text: string | PromptItem[]): Promise<string>;
  destroy(): void;
}

/**
 * Initializes the browser's built-in language model.
 * Caches the model instance to avoid re-creation.
 * @returns The initialized model instance or null if initialization fails.
 */
async function initializeBrowserModel(context: PromptItem[]): Promise<BrowserAIModel | null> {
  try {
    // Check if the API exists
    // Use a more specific type for window to satisfy the linter
    const ai = (
      window as Window & {
        ai?: {
          languageModel?: {
            create?: (opts?: { systemPrompt?: string; initialPrompts?: PromptItem[] }) => Promise<unknown>;
          };
        };
      }
    ).ai;
    if (!ai || !ai.languageModel || typeof ai.languageModel.create !== 'function') {
      return null;
    }

    // Cast the result of create more carefully if possible, or keep as unknown then cast
    const model = (await ai.languageModel.create({
      systemPrompt: `You are a helpful assistant, answering questions based on the conversation context.`,
      initialPrompts: context,
    })) as BrowserAIModel;
    return model;
  } catch (error) {
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

  const prompt: PromptItem[] = [];

  for (const message of conversationContext) {
    if (message.type === ChatMessageType.USER) {
      prompt.push({
        role: 'user',
        content: message.content,
      });
    } else if (message.type === ChatMessageType.ASSISTANT) {
      prompt.push({
        role: 'assistant',
        content: message.content,
      });
    }
  }

  const model = await initializeBrowserModel(prompt);
  if (!model) {
    return [];
  }

  try {
    const lastMessage = conversationContext[conversationContext.length - 1];
    const isQuestion =
      (await model.prompt(`Does this message contain a question? 

<Message>${lastMessage.content}</Message>
        
Answer with "yes" or "no".`)) === 'yes';

    if (!isQuestion) {
      return [];
    }

    const response = await model.prompt(
      `Given this message:

<Message>${lastMessage.content}</Message>

Please provide max 10 suggestions how the user could answer the question, separated by newlines, maximum few word long, do not prefix with a number.`,
    );

    // Parse the response into an array of suggestions
    const suggestions = response
      .split('\n') // Split by newline
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return suggestions;
  } catch (error) {
    console.error('Failed to generate suggestions using browser AI model:', error);
    return [];
  } finally {
    model.destroy();
  }
}
