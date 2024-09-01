/**
 * Function definition for askQuestion
 */
export const askQuestion = {
  name: 'askQuestion',
  description:
    'If there is a need ask a question to the user to gather more information or clarification. Alternatively this function can be called also if there is no need to prompt the user with any question.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The message you want to display to the user, it can be either a question or a confirmation/ackoweledgment in case there is no intention to prompt the user.',
      },
      shouldPrompt: {
        type: 'boolean',
        description: 'Set to true if the intention is to get response from the user.',
      },
      promptNecessity: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'How strong is the need to prompt the user? Higher value indicates a stronger need.',
      },
      stopCodegen: {
        type: 'boolean',
        description:
          'If set to true, it will break the code generation process without error, so you should use this parameter if you want to stop the code generation process.',
      },
      requestFilesContent: {
        type: 'array',
        description:
          'This object property is used to request file contents to be provided by the user, use this property when a content of a file is missing(null in getSourceCode response), but we know that it exists.' +
          'An array of absolute paths of files that should be used to provide context for the following updates. Context files could be for example the dependencies, or files that depend on one of the files that we want to update in the next step.',
        items: {
          type: 'string',
        },
      },
      requestPermissions: {
        type: 'object',
        description:
          "Use this property to request enablement of permissions for code generation process if you detect that you don't have this permission listed in the requirements.",
        properties: {
          allowDirectoryCreate: {
            description: 'Set to `true` to request permission for creating directories.',
            type: 'boolean',
          },
          allowFileCreate: {
            description: 'Set to `true` to request permission for creating files.',
            type: 'boolean',
          },
          allowFileDelete: {
            description: 'Set to `true` to request permission for deleting files.',
            type: 'boolean',
          },
          allowFileMove: {
            description: 'Set to `true` to request permission for moving files.',
            type: 'boolean',
          },
          enableVision: {
            description:
              'Set to `true` to request permission for vision capabilities, using images as a context for further code generation operations.',
            type: 'boolean',
          },
          enableImagen: {
            description: 'Set to `true` to request permission for generation of images.',
            type: 'boolean',
          },
        },
      },
    },
    required: ['content', 'shouldPrompt', 'promptNecessity', 'stopCodegen'],
  },
} as const;
