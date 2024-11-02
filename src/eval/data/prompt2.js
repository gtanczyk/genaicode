import { getSystemPrompt } from '../../prompt/systemprompt';

export const DEBUG_PROMPT2 = [
  {
    type: 'systemPrompt',
    systemPrompt: getSystemPrompt({ verbose: false, askQuestion: true, interactive: false, ui: true }),
  },
  {
    type: 'user',
    text: 'Hello, GenAIcode!',
  },
  {
    type: 'assistant',
    text: 'Hello there! I guess you have a task for me today. Before we start, could you please provide me with the current source code of your application, and the image assets?',
    functionCalls: [
      {
        name: 'getSourceCode',
      },
      {
        name: 'getImageAssets',
      },
    ],
  },
  {
    type: 'user',
    functionResponses: [
      {
        name: 'getSourceCode',
        content: JSON.stringify({
          '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers': {
            'cancel-code-generation.ts': { summary: 'Handles the cancellation of code generation.' },
            'confirm-code-generation.ts': { summary: 'Handles confirmation of code generation' },
            'context-optimization.ts': { summary: 'Handles context optimization' },
            'default-action.ts': { summary: 'Default action handler' },
            'handle-request-answer-with-image.ts': {
              summary: 'Handles request to generate image and display it to user',
            },
            'handle-request-answer.ts': { summary: 'Handles user answer requests' },
            'handler-utils.ts': { summary: 'Utility functions for step-ask-question handlers' },
            'remove-files-from-context.ts': { summary: 'Handles removing files from context' },
            'request-files-content.ts': { summary: 'Handles requesting content of missing files' },
            'request-permissions.ts': { summary: 'Handles requesting permissions from user' },
            'start-code-generation.ts': { summary: 'Handles the start of code generation.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt': {
            'ai-service-fallback.ts': { summary: 'Handles AI service fallback when rate limit is exceeded.' },
            'function-calling-validate.ts': {
              summary: 'Validates function calls to ensure they match the expected schema.',
            },
            'function-calling.ts': { summary: 'Defines function definitions for function calling.' },
            'limits.test.ts': { summary: 'Tests for prompt and source code token limits.' },
            'limits.ts': { summary: 'Defines functions to verify prompt and source code token limits.' },
            'prompt-codegen.test.ts': { summary: 'Tests for code generation prompt and lint fix prompt.' },
            'prompt-codegen.ts': { summary: 'Generates code generation prompt and lint fix prompt.' },
            'prompt-consts.ts': { summary: 'Defines a constant for the code generation trigger.' },
            'prompt-service-ask-question.test.ts': { summary: 'Tests the prompt service with askQuestion feature.' },
            'prompt-service.test.ts': { summary: 'Tests for the prompt service.' },
            'prompt-service.ts': {
              summary: 'Implements promptService function that handles code generation prompts and responses.',
            },
            'systemprompt.test.ts': { summary: 'Tests for the system prompt.' },
            'systemprompt.ts': {
              summary:
                'Generates system prompt for the code generation assistant, defines guidelines and usage of key functions',
            },
            'token-estimator.ts': { summary: 'Estimates token count for text and code.' },
          },
        }),
      },
      {
        name: 'getImageAssets',
        content:
          '{"/Users/gtanczyk/src/codegen/media/logo-dark.png":{"mimeType":"image/png","width":1200,"height":686},"/Users/gtanczyk/src/codegen/media/logo.png":{"mimeType":"image/png","width":1200,"height":686},"/Users/gtanczyk/src/codegen/src/vite-genaicode/media/demo-for-readme.gif":{"mimeType":"image/gif","width":769,"height":465}}',
      },
    ],
    cache: true,
    text: 'Sure, here is the application source code and image assets.',
  },
  {
    type: 'assistant',
    text: "Thank you, I'm ready to assist you with your request.",
  },
  {
    type: 'user',
    text: 'could you please have a look at the system prompt, and analyze it?',
  },
  {
    type: 'assistant',
    text: 'Thank you for describing the task, I have noticed you have provided a very large context for your question. The amount of source code is very big in particular. Can we do something about it?',
  },
  {
    type: 'user',
    text: 'You\'re correct, we need to optimize the context for code generation. Please perform the following tasks and respond by calling the `optimizeContext` function with the appropriate arguments:\n\n1. **Relevance and Token Cost Evaluation**:\n   - Rate the **relevance** of each file to the user\'s prompt on a scale from **0 to 1**, using the following guidelines:\n     - **0.0 – 0.3 (Not Relevant)**: The file has no apparent connection to the user\'s prompt.\n     - **0.3 – 0.7 (Somewhat Relevant)**: The file has minor or indirect relevance to the prompt.\n     - **0.7 – 0.9 (Moderately Relevant)**: The file is related and could contribute to addressing the prompt.\n     - **0.9 – 1.0 (Highly Relevant)**: The file is directly related and is important for addressing the prompt.\n   - **Evaluation Criteria**:\n     - **Keyword Matching**: Does the file contain keywords or topics mentioned in the user\'s prompt?\n     - **Functional Alignment**: Does the file implement features or functionalities requested by the user?\n     - **Dependency**: Is the file a dependency of other relevant modules?\n   - Prioritize files with higher relevance scores, but be mindful of the total token count.\n   - Consider the cost of adding more tokens; prioritize files where the relevance justifies the token usage.\n\n2. **Token-Aware Optimization**:\n   - Aim to optimize the context: less relevant files with higher token count should not be added to the context\n   - Do not add irrelevant files to context\n   - The goal is to have as much as possible of high relevancy files in the context while keeping the total token count reasonably low\n\n3. **Function Call Response**:\n   - Respond by **calling the `optimizeContext` function**.\n   - The function should have the following parameters:\n     - `"userPrompt"`: The user\'s original prompt.\n     - `"optimizedContext"`: An array of objects, each containing:\n       - `"filePath"`: The absolute file path.\n       - `"relevance"`: The calculated relevance score (0 to 1).\n\n**Important Guidelines**:\n- **Only include files that are mentioned in `getSourceCode` function response**. **Do not add any other files**.\n- **Do not infer or guess additional files**.\n- **Evaluate each file individually** based on the criteria above.\n- **Avoid assumptions or hallucinations**; stick strictly to the provided data.\n- Ensure the **function call is properly formatted** and **valid**.\n- **Provide the response in valid JSON format**.\n- **Do not include any extra text** outside of the function call.\n- **Ensure the JSON is properly formatted** and **does not contain strings representing JSON** (i.e., do not stringify the JSON, do not wrap strings into quotes).\n- **Do not return files which are not relevant to the user prompt. Use relevance rating to judge that**\n- **Formulate full file paths correctly using directoryPath and filePath from the `getSourceCode` function response**.\n\n**Example of valid Function Call**:\n\n```json\n{\n  "function": "optimizeContext",\n  "arguments": {\n    "userPrompt": "Please review the helper module.",\n    "optimizedContext": [\n      {\n        "path": "/home/src/utils/helpers.js",\n        "relevance": 0.9,\n      },\n      {\n        "path": "/home/src/utils/math.js",\n        "relevance": 0.4,\n      }\n    ]\n  }\n}\n```\n\nNow could you please analyze the source code and return me the optimized context?\n',
  },
];
