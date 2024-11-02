/**
 * Static prompts used in the prompt-service module.
 * These prompts are used in the initial conversation with the AI service.
 */

/** Initial greeting from the user */
export const INITIAL_GREETING = 'Hello, GenAIcode!';

/** Assistant's response asking for source code and other assets */
export const REQUEST_SOURCE_CODE = `Hello there! I guess you have a task for me today. Before we start, could you please provide me with: 
      - the current source code of your application
      - the image assets (if available)
      - and conversational history (if available)
      
      Thanks`;

/** User's response when providing source code and assets */
export const SOURCE_CODE_RESPONSE = 'Sure, here is the application source code, image assets, and the history.';

/** Assistant's acknowledgment after receiving source code */
export const READY_TO_ASSIST = "Thank you, I'm ready to assist you with your request.";

/** Template for partial prompt when requesting changes for a specific file */
export const getPartialPromptTemplate = (path: string): string =>
  `Thank you for providing the summary, now suggest changes for the \`${path}\` file using appropriate tools.`;
