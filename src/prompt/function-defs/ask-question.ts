/**
 * Function definition for askQuestion
 */
export const askQuestion = {
  name: 'askQuestion',
  description:
    'Use this function to ask a question or seek clarification from the user if needed. If you have all the necessary information and are ready to proceed, do not call this function.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The message you want to display to the user. It can be a question if you need more information, or a confirmation/acknowledgment if you are proceeding without needing a response.',
      },
      shouldPrompt: {
        type: 'boolean',
        description:
          'Set to true **only if** you require a response from the user before proceeding. Set to false if you do not require a response and are ready to proceed with the task.',
      },
      promptNecessity: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description:
          'Indicates how strongly you need a response from the user. A higher value means a stronger need for user input.',
      },
      stopCodegen: {
        type: 'boolean',
        description:
          'Set to true if you want to stop the code generation process without error. Use this when you cannot proceed due to insufficient information or other issues.',
      },
      requestFilesContent: {
        type: 'array',
        description:
          'An array of absolute file paths for which you need the content. Use this when specific files are missing and you need them to proceed with the task.',
        items: {
          type: 'string',
        },
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
    required: ['content', 'shouldPrompt', 'promptNecessity', 'stopCodegen'],
  },
} as const;
