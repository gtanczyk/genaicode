/**
 * Function definition for getSourceCode
 */
export const getSourceCode = {
  name: 'getSourceCode',
  description:
    'This function returns source code of the application in Map format, where absolute file path is the key, and the value is an object, where one of the properties may be the content of the file. Some keys may not provide content. This function can be called only once during the conversation, and only if suggested by the user.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        description: 'An array of absolute paths of files that should be used to provided context.',
        items: {
          type: 'string',
        },
      },
    },
    required: [],
  },
};
