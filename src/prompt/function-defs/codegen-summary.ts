import { FunctionDef } from '../../ai-service/common.js';
import { getRegisteredOperations } from '../../main/plugin-loader.js';

/**
 * Function definition for codegenSummary
 */
export const getCodegenSummaryDef = (): FunctionDef => ({
  name: 'codegenSummary',
  description:
    'This function is called with a summary of proposed updates.\n' +
    '- `explanation`: A general explanation of the planned code generation updates or reasoning for no code changes.\n' +
    '- `fileUpdates`: A list of proposed file updates, including all affected files and dependencies.\n' +
    '- `contextPaths`: A list of file paths that make sense to use as context for code generation requests.\n' +
    'It is critically important to adhere to the schema of parameters and include all relevant files.',
  parameters: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'A brief description of the planned changes or an explanation if no changes are proposed.',
      },
      fileUpdates: {
        type: 'array',
        description: 'An array of proposed file updates, each update is an object with several properties.',
        items: {
          type: 'object',
          description:
            'An object representing a proposed update to a file, containing properties like the absolute file path, the update tool name, and other important properties.',
          properties: {
            filePath: {
              type: 'string',
              description:
                'An absolute path of the project file that will be updated. This must be an absolute file path.',
            },
            prompt: {
              type: 'string',
              description:
                'A detailed prompt that will be passed to the model request together with the tool request. It summarizes the planned changes for this particular file.',
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
                ...getRegisteredOperations().map((operation) => operation.def.name),
              ],
              description: 'The name of the tool that will be used to perform the update.',
            },
            temperature: {
              type: 'number',
              description:
                'Temperature parameter for the LLM request. Should be within the range [0.0, 2.0]. Lower values make the output more deterministic.',
              minimum: 0.0,
              maximum: 2.0,
            },
            cheap: {
              type: 'boolean',
              description:
                'If true, the prompt will be executed with a cheaper, faster model that provides lower quality results. Use only when lower quality results are acceptable.',
            },
            contextImageAssets: {
              type: 'array',
              description:
                'A list of absolute image asset paths that should be included in the context of the LLM request. Use this parameter when there is a need to analyze an image.',
              items: { type: 'string' },
            },
          },
          required: ['filePath', 'prompt', 'updateToolName'],
        },
      },
      contextPaths: {
        type: 'array',
        description:
          'An array of absolute file paths that should be used to provide context for the following updates. These could be dependencies or files that depend on the files to be updated.',
        items: {
          type: 'string',
        },
      },
    },
    required: ['explanation', 'fileUpdates', 'contextPaths'],
  },
});
