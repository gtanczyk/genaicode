/**
 * Function definition for askQuestion
 */
export const askQuestion = {
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
          'requestPermissions',
          'requestFileContent',
          'confirmCodeGeneration',
          'startCodeGeneration',
          'cancelCodeGeneration',
        ],
        description:
          'This value instructs the program on what should happen next. Use "requestAnswer" for analysis requests or clarifications.',
      },
      content: {
        type: 'string',
        description:
          'The message you want to display to the user. It can be a question if you need more information, an analysis result, or a confirmation request before proceeding with code generation.',
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
} as const;
