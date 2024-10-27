import { FunctionDef } from '../../ai-service/common';
import { getRegisteredActionHandlerDescriptions, getRegisteredActionHandlers } from '../../main/plugin-loader.js';

/**
 * Function definition for askQuestion
 *
 * Use this function to ask questions, seek clarification, request file permissions, or manage the flow of the conversation.
 * Each actionType serves a specific purpose, ensuring clarity and proper task execution.
 */
function getActionTypeDescription(): string {
  const pluginDescriptions = Array.from(getRegisteredActionHandlerDescriptions().entries())
    .map(([actionType, description]) => ` - ${actionType}: ${description}`)
    .join('\n');

  return `This value instructs the program on what should happen next. Use "requestAnswer" for analysis requests or clarifications.,

Detailed Explanation of actionTypes:
- requestAnswer: Use for general information, clarifications, or when no specific code is needed.
- requestAnswerWithImage: Use when the question can be better explained with an accompanying image. Requires imageGenerationRequest parameter to generate the supporting image.
- requestPermissions: Use when additional permissions are required for actions like creating or deleting files.
- requestFilesContent: Use specifically when needing to access or review the contents of files.
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
  description:
    'Use this function to ask a question, seek clarification, or manage the flow of the conversation. For analysis requests, use actionType "requestAnswer". Only proceed to code generation when explicitly instructed or after confirmation.',
  parameters: {
    type: 'object',
    properties: {
      actionType: {
        type: 'string',
        enum: [
          'requestAnswer',
          'requestAnswerWithImage',
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
      content: {
        type: 'string',
        description:
          'The message you want to display to the user. It can be a question if you need more information, an analysis result, or a confirmation request before proceeding with code generation.',
      },
      imageGenerationRequest: {
        type: 'object',
        description:
          'When using requestAnswerWithImage, this object specifies how to generate the image that supports the question.',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt that will be used to generate the image.',
          },
          contextImage: {
            type: 'string',
            description: 'Optional path to an image file that will be used as context for image generation.',
          },
        },
        required: ['prompt'],
      },
      promptNecessity: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description:
          'Indicates how strongly you need a response from the user. A higher value means a stronger need for user input.',
      },
      requestFilesContent: {
        type: 'array',
        description:
          'An array of absolute file paths for which you need the content. Use this when specific files are missing and you need them to proceed with the task.',
        items: {
          type: 'string',
        },
      },
      removeFilesFromContext: {
        type: 'array',
        description:
          'An array of absolute file paths that should be removed from the context. Use this to optimize token usage by removing unnecessary file contents.',
        items: {
          type: 'string',
        },
      },
      contextOptimization: {
        type: 'string',
        description:
          'A prompt generated to guide the LLM in optimizing context by specifying which parts of the context are most relevant to keep. This helps in efficient management during code generation tasks.',
      },
      requestPermissions: {
        type: 'object',
        description:
          'Use this to request additional permissions needed for code generation if they are not already granted.',
        properties: {
          allowDirectoryCreate: {
            description: 'Set to true to request permission for creating directories.',
            type: 'boolean',
          },
          allowFileCreate: {
            description: 'Set to true to request permission for creating files.',
            type: 'boolean',
          },
          allowFileDelete: {
            description: 'Set to true to request permission for deleting files.',
            type: 'boolean',
          },
          allowFileMove: {
            description: 'Set to true to request permission for moving files.',
            type: 'boolean',
          },
          enableVision: {
            description:
              'Set to true to request permission for vision capabilities, using images as context for code generation.',
            type: 'boolean',
          },
          enableImagen: {
            description: 'Set to true to request permission for generating images.',
            type: 'boolean',
          },
        },
      },
    },
    required: ['actionType', 'content', 'promptNecessity'],
  },
});
