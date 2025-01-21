import { FunctionDef } from '../../ai-service/common-types.js';
import { getRegisteredOperations } from '../../main/plugin-loader.js';

/**
 * Function definition for codegenSummary
 */
export const getCodegenSummaryDef = (): FunctionDef => ({
  name: 'codegenSummary',
  description: `This function is called with a summary of proposed updates.
- \`explanation\`: A step by step explanation of the planned code generation updates or reasoning for no code changes.
- \`fileUpdates\`: A list of proposed file updates, including all affected files and dependencies.
- \`contextPaths\`: A list of file paths that make sense to use as context for code generation requests.

It is critically important to adhere to the schema of parameters and include all relevant files.
When generating the codegen summary, the assistant will make use of preceding \`codegenPlanning\` function call.
Codegen summary is a derivative of the codegen planning step, the final step before code generation is executed.
.`,
  parameters: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'A step by step description of the planned changes or an explanation if no changes are proposed.',
      },
      fileUpdates: {
        type: 'array',
        description: `An array of proposed file updates, each update is an object with several properties.
The file updates are a consequence of the code generation planning step.`,
        items: {
          type: 'object',
          description:
            'An object representing a proposed update to a file, containing properties like the absolute file path, the update tool name, and other important properties.',
          properties: {
            prompt: {
              type: 'string',
              description:
                'A detailed prompt that will be passed to the model request together with the tool request. It should be detailed as much as possible.',
            },
            filePath: {
              type: 'string',
              description:
                'An absolute path of the project file that will be updated. This must be an absolute file path.',
            },
            updateToolCoT: {
              type: 'string',
              description: `Step by step reasoning for choosing the function that will be used to perform the update.`,
            },
            updateToolName: {
              type: 'string',
              enum: [
                'updateFile',
                'createFile',
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
              description: 'The name of the function that will be used to perform the update.',
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
          required: ['prompt', 'filePath', 'updateToolName'],
        },
      },
      contextPaths: {
        type: 'array',
        description: 'An array of absolute file paths that should be used to provide context for file updates.',
        items: {
          type: 'string',
        },
      },
    },
    required: ['explanation', 'fileUpdates', 'contextPaths'],
  },
});
