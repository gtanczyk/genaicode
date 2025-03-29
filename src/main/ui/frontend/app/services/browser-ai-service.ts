// Define the interface for the browser AI model based on the example usage
import { ChatMessage, ChatMessageType } from '../../../../common/content-bus-types.js';

interface BrowserAIModel {
  prompt(text: string): Promise<string>;
}

// Cache for the initialized model
let cachedModel: BrowserAIModel | null = null;
let isInitializing = false; // Prevent race conditions

/**
 * Initializes the browser's built-in language model.
 * Caches the model instance to avoid re-creation.
 * @returns The initialized model instance or null if initialization fails.
 */
export async function initializeBrowserModel(): Promise<BrowserAIModel | null> {
  // Return cached model if already initialized
  if (cachedModel) {
    return cachedModel;
  }

  // If initialization is already in progress, wait for it to complete
  if (isInitializing) {
    // Simple wait mechanism - might need refinement for production
    await new Promise((resolve) => setTimeout(resolve, 100));
    return cachedModel;
  }

  isInitializing = true;

  try {
    // Check if the API exists
    // Use a more specific type for window to satisfy the linter
    const ai = (window as Window & { ai?: { languageModel?: { create?: () => Promise<unknown> } } }).ai;
    if (!ai || !ai.languageModel || typeof ai.languageModel.create !== 'function') {
      console.warn('Browser AI Language Model API (ai.languageModel.create) not available.');
      isInitializing = false;
      return null;
    }

    // Attempt to create the model
    console.log('Attempting to initialize browser AI model...');
    // Cast the result of create more carefully if possible, or keep as unknown then cast
    const model = (await ai.languageModel.create()) as BrowserAIModel;
    console.log('Browser AI model initialized successfully.');
    cachedModel = model; // Assign the successfully created model
    isInitializing = false;
    return cachedModel;
  } catch (error) {
    console.error('Failed to initialize browser AI model:', error);
    isInitializing = false;
    return null;
  }
}

/**
 * Generates suggestions based on the conversation context using the browser AI model.
 * @param conversationContext An array of ChatMessage objects representing the recent conversation.
 * @returns A promise that resolves to an array of suggestion strings, or an empty array on failure.
 */
export async function generateSuggestions(conversationContext: ChatMessage[]): Promise<string[]> {
  if (!conversationContext || conversationContext.length === 0) {
    console.warn('Conversation context is empty, cannot generate suggestions.');
    return [];
  }

  const model = await initializeBrowserModel();

  if (!model) {
    console.warn('Browser AI model not initialized, cannot generate suggestions.');
    return [];
  }

  try {
    // Construct the prompt for the model, including context
    // Removed unnecessary escapes for double quotes within the template literal
    let prompt = `Provide exactly 3 short, few word answers to the latest assistant's question, considering the preceding user messages if available. Separate each answer with a newline character:\n\n`;

    for (const message of conversationContext) {
      if (message.type === ChatMessageType.USER) {
        prompt += `User: ${message.content}\n`;
      } else if (message.type === ChatMessageType.ASSISTANT) {
        prompt += `Assistant: ${message.content}\n`;
      }
    }

    console.log('Generating suggestions with browser AI model using context...');
    console.log('Prompt:', prompt); // Log the constructed prompt for debugging
    const response = await model.prompt(prompt);
    console.log('Browser AI model response:', response);

    // Parse the response into an array of suggestions
    const suggestions = response
      .split('\n') // Split by newline
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Basic validation/cleanup
    const cleanedSuggestions = suggestions.slice(0, 3); // Take max 3

    console.log('Generated suggestions:', cleanedSuggestions);
    return cleanedSuggestions;
  } catch (error) {
    console.error('Failed to generate suggestions using browser AI model:', error);
    return [];
  }
}
