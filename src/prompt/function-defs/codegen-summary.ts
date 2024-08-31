import { temperature, cheap } from '../../cli/cli-params.js';

/**
 * Function definition for codegenSummary
 */
export const codegenSummary = {
  name: 'codegenSummary',
  description:
    'This function is called with a summary of proposed updates.' +
    'Summary is a data structure(object) which contains:\n' +
    '- `fileUpdates`: list of proposed file updates that will be subject to subsequent code generation request\n' +
    '- `contextPaths`: list of file paths that make sense to use as a context for code generation requests.' +
    '- `explanation`: general explanation of planned code generation updates\n' +
    'It is crticially important to adhere to the schema of parameters',
  parameters: {
    type: 'object',
    properties: {
      contextPaths: {
        type: 'array',
        description:
          'An array of absolute paths of files that should be used to provide context for the following updates. Context files could be for example the dependencies, or files that depend on one of the files that we want to update in the next step.',
        items: {
          type: 'string',
        },
      },
      fileUpdates: {
        type: 'array',
        description: 'An array of proposed file updates, each update is an object with several properties.',
        items: {
          type: 'object',
          description:
            'Proposed update of a file. The update is an object which contains properties like absolute file path, update tool name, and few other important properties.',
          properties: {
            path: {
              type: 'string',
              description:
                'An absolute path of the project file that will be updated. This must be an absolute file path.',
            },
            updateToolName: {
              type: 'string',
              enum: [
                'createFile',
                'updateFile',
                'patchFile',
                'deleteFile',
                'createDirectory',
                'moveFile',
                'generateImage',
                'downloadFile',
                'splitImage',
                'resizeImage',
                'imglyRemoveBackground',
              ],
              description: 'A name of the tool that will be used to perform the update.',
            },
            temperature: {
              type: 'number',
              description:
                'Temperature parameter that will be used for LLM request. The value is adjusted to the characteristic of the update. If there is a need for a more creative solution, the value should be lower, but stil within [0.0, 2.0] range. The default value is: ' +
                temperature,
            },
            cheap: {
              type: 'boolean',
              description:
                'true value means that the prompt will be executed with cheaper model, which work faster, but provides lower quality results, so please use it only in situation when lower quality results are acceptable for the prompt. The default value is: ' +
                !!cheap,
            },
            prompt: {
              type: 'string',
              description:
                'Prompt that will be passed to the model request together with the tool request. It summarizes the planned changes for this particular file, so it should be detailed enough for the model to generate necessary changes.',
            },
            contextImageAssets: {
              type: 'array',
              description:
                'A list of of absolute image asset paths that should be included to the context of LLM request.' +
                'This parameter must be used if there is a need to analyze an image.',
              items: { type: 'string' },
            },
          },
          required: ['path', 'updateToolName'],
        },
      },
      explanation: {
        type: 'string',
        description: 'Explanation of planned changes or explanation of reasoning for no code changes',
      },
    },
    required: ['fileUpdates', 'contextPaths'],
  },
} as const;
