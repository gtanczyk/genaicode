import { FunctionDef } from '../../ai-service/common';
import { getRegisteredActionHandlerDescriptions, getRegisteredActionHandlers } from '../../main/plugin-loader.js';

function getActionTypeDescription(): string {
  const pluginDescriptions = Array.from(getRegisteredActionHandlerDescriptions().entries())
    .map(([actionType, description]) => ` - ${actionType}: ${description}`)
    .join('\n');

  return `This value instructs the program on what should happen next.

Detailed Explanation of actionTypes:
- sendMessage: Use for general information, clarifications, or when no specific code is needed.
- sendMessageWithImage: Use when an image is needed to provide context or additional information.
- requestPermissions: Use when additional permissions are required for actions like creating or deleting files.
- requestFilesContent: Use specifically when needing to access or review the contents of files, and it was not provided yet in any of preceeding \`getSourceCode\` function responses.
- removeFilesFromContext: Use to remove unnecessary file contents from context, optimizing token usage.
- confirmCodeGeneration: Use to confirm with the user before starting code generation tasks.
- startCodeGeneration: Use only after receiving confirmation to begin code generation.
- cancelCodeGeneration: Use if code generation should be stopped or canceled.
- contextOptimization: Use to manage and optimize context during code generation tasks, allowing the LLM to provide guidance on what parts of the context are most relevant to keep.
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
  The \`message\` property must align with the chosen \`actionType\`.`,
  parameters: {
    type: 'object',
    properties: {
      actionType: {
        type: 'string',
        enum: [
          'sendMessage',
          'sendMessageWithImage',
          'requestPermissions',
          'requestFilesContent',
          'removeFilesFromContext',
          'confirmCodeGeneration',
          'startCodeGeneration',
          'cancelCodeGeneration',
          'contextOptimization',
          ...Array.from(getRegisteredActionHandlers().keys()),
        ],
        description: getActionTypeDescription(),
      },
      message: {
        type: 'string',
        description: 'The message to display to the user.',
      },
    },
    required: ['actionType', 'message'],
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
