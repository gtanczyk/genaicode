import { FunctionDef } from '../../ai-service/common';
import { rcConfig } from '../../main/config';
import { getRegisteredActionHandlerDescriptions, getRegisteredActionHandlers } from '../../main/plugin-loader.js';

function getActionTypeDescription(): string {
  const pluginDescriptions = Array.from(getRegisteredActionHandlerDescriptions().entries())
    .map(([actionType, description]) => ` - ${actionType}: ${description}`)
    .join('\n');

  return `This value instructs the program on what should happen next.

Detailed Explanation of actionTypes:
- sendMessage: Use for general information, clarifications, or when no specific code is needed.
- sendMessageWithImage: Use when an image is needed to provide context or additional information.
- requestPermissions: Use **only when you lack necessary permissions** for actions like creating, deleting, or moving files, and need to request them from the user.
- requestFilesContent: Use specifically when needing to access or review the contents of files, and it was not provided yet in any of preceeding \`getSourceCode\` function responses.
- removeFilesFromContext: Use to remove unnecessary file contents from context, optimizing token usage.
- confirmCodeGeneration: Use to confirm with the user before starting code generation tasks.
- cancelCodeGeneration: Use to stop the session, and the conversation.
- contextOptimization: Use to manage and optimize context during code generation tasks, allowing the LLM to provide guidance on what parts of the context are most relevant to keep.
- searchCode: Use to search through source code files with flexible filtering. Supports searching in file contents and names, with pattern matching and case sensitivity options. Useful for finding specific code patterns or references across the codebase.
${rcConfig.lintCommand ? '- lint: Use to check the code for errors and provide feedback on the quality of the code.' : ''}
${pluginDescriptions}`;
}

/**
 * Function definition for askQuestion
 *
 * Use this function to ask questions, seek clarification, request file permissions, or manage the flow of the conversation.
 * Each actionType serves a specific purpose, ensuring clarity and proper task execution.
 */
export const getAskQuestionDef = (): FunctionDef => ({
  name: 'askQuestion',
  description: `Use this function to interact with the user for various purposes.
  The \`decisionMakingProcess\` must be provided as first parameter to ensure clarity in decision-making, and impact on selection of \`actionType\` and \`message\`.
  The \`message\` property must align with the chosen \`actionType\`.
  
  The desired format of parameters is as follows:
  \`\`\`
  {
    "decisionMakingProcess": "...", // A detailed decision-making framework the assistant followed before selecting an action.",
    "actionType": "...", // The type of action to perform.
    "message": "..." // The message to display to the user.
  }
  \`\`\`
  
  **IMPORTANT**: Mind the order of the parameters, as the decision-making process must be provided first to ensure clarity in decision-making.
  `,
  parameters: {
    type: 'object',
    properties: {
      decisionMakingProcess: {
        type: 'string',
        description: `A detailed decision-making framework the assistant followed before selecting an action. You must think step about step about this, this process should include the following steps:

1. **Contextual Analysis**: Assess the current information, including available permissions, current context, and task requirements. Identify any missing elements that are critical to task completion.

2. **Decision Justification**: State the reasoning for the proposed action, considering whether planning, clarification, or action is required. If there's any ambiguity, prefer a confirmatory action (\`confirmCodeGeneration\`).

3. **Minimal Action Selection**: Determine the minimal action that can make progress toward the task goal. Avoid requesting unnecessary permissions or context that isn't strictly needed.

4. **Evaluation of Action Choice**: Double-check if the selected action aligns with task requirements and user-provided constraints.

Output this in step-by-step format to ensure clarity in decision-making.`,
      },
      actionType: {
        type: 'string',
        enum: [
          'sendMessage',
          'sendMessageWithImage',
          'requestPermissions',
          'requestFilesContent',
          'removeFilesFromContext',
          'confirmCodeGeneration',
          'cancelCodeGeneration',
          'contextOptimization',
          'searchCode',
          ...(rcConfig.lintCommand ? ['lint'] : []),
          ...Array.from(getRegisteredActionHandlers().keys()),
        ],
        description: getActionTypeDescription(),
      },
      message: {
        type: 'string',
        description: 'The message to display to the user.',
      },
    },
    required: ['decisionMakingProcess', 'actionType', 'message'],
  },
});

// requestFilesContent
export const requestFilesContent: FunctionDef = {
  name: 'requestFilesContent',
  description: 'Use this function to request the content of files that are missing from the context.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'An array of absolute file paths for which you need the content.',
      },
    },
    required: ['filePaths'],
  },
};

// sendMessageWithImage
export const sendMessageWithImage: FunctionDef = {
  name: 'sendMessageWithImage',
  description:
    'Use this function to send message to the user with accompanying image that will be generated using provided prompt, and optionally using other image as a context.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The prompt used to generate the image.',
      },
      contextImage: {
        type: 'string',
        description: 'Optional path to an image file used as context for image generation.',
      },
    },
    required: ['prompt'],
  },
};

// removeFilesFromContext
export const removeFilesFromContext: FunctionDef = {
  name: 'removeFilesFromContext',
  description: 'Use this function to remove files from the context that are no longer needed for code generation.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'An array of absolute file paths to remove from the context.',
      },
    },
    required: ['filePaths'],
  },
};

// contextOptimization
export const contextOptimization: FunctionDef = {
  name: 'contextOptimization',
  description:
    'Use this function to optimize the context for code generation by specifying which parts are most relevant to keep.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The prompt used to guide the user in optimizing the context.',
      },
    },
    required: ['prompt'],
  },
};

// requestPermissions
export const requestPermissions: FunctionDef = {
  name: 'requestPermissions',
  description: 'Use this function to request additional permissions needed for code generation if not already granted.',
  parameters: {
    type: 'object',
    properties: {
      allowDirectoryCreate: {
        description: 'Request permission to create directories.',
        type: 'boolean',
      },
      allowFileCreate: {
        description: 'Request permission to create files.',
        type: 'boolean',
      },
      allowFileDelete: {
        description: 'Request permission to delete files.',
        type: 'boolean',
      },
      allowFileMove: {
        description: 'Request permission to move files.',
        type: 'boolean',
      },
      enableVision: {
        description: 'Request permission for vision capabilities, using images as context for code generation.',
        type: 'boolean',
      },
      enableImagen: {
        description: 'Request permission to generate images.',
        type: 'boolean',
      },
    },
    required: [
      'allowDirectoryCreate',
      'allowFileCreate',
      'allowFileDelete',
      'allowFileMove',
      'enableVision',
      'enableImagen',
    ],
  },
};

// searchCode
export const searchCode: FunctionDef = {
  name: 'searchCode',
  description: 'Use this function to search through source code files with flexible filtering.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      includePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to include files',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to exclude files',
      },
      searchInContent: {
        type: 'boolean',
        description: 'Whether to search in file contents (default: true)',
      },
      searchInFilenames: {
        type: 'boolean',
        description: 'Whether to search in file names (default: true)',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50)',
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines to include around content matches (default: 2)',
      },
    },
    required: ['query'],
  },
};
