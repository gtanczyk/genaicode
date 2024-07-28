import { requireExplanations } from '../cli/cli-params.js';

/**
 * Function definitions for function calling feature
 */
export const functionDefs = [
  {
    name: 'codegenSummary',
    description:
      'This function is called with a summary of proposed updates. It contains a list of file paths that will be updated.',
    parameters: {
      type: 'object',
      properties: {
        filePaths: {
          type: 'array',
          description: 'A list of absolute paths of file that will be updated.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['filePaths'],
    },
  },
  {
    name: 'updateFile',
    description:
      'Update a file with new content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to update.',
        },
        newContent: {
          type: 'string',
          description: 'The content to update the file with. Must not be empty.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind the suggested code changes for this file',
        },
      },
      required: ['filePath', 'newContent'],
    },
  },
  {
    name: 'updateFilePartial',
    description:
      'Partially update a file content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to update.',
        },
        patch: {
          type: 'string',
          description: 'Modification to the file expressed in a diff format.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind the suggested code changes for this file',
        },
      },
      required: ['filePath', 'patch'],
    },
  },
  {
    name: 'createFile',
    description:
      'Create a new file with specified content. The file will be created inside of project folder structure.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to create.',
        },
        newContent: {
          type: 'string',
          description: 'The content for the new file.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind creating this file',
        },
      },
      required: ['filePath', 'newContent'],
    },
  },
  {
    name: 'deleteFile',
    description: 'Delete a specified file from the application source code.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to delete.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind deleting this file',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'explanation',
    description: 'Explain the reasoning behind the suggested code changes or reasoning for lack of code changes',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The explanation text',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'createDirectory',
    description: 'Create a new directory',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The directory path to create.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind creating this directory',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'moveFile',
    description: 'Move a file from one location to another',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The current file path.',
        },
        destination: {
          type: 'string',
          description: 'The new file path.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind moving this file',
        },
      },
      required: ['source', 'destination'],
    },
  },
].map((fd) => {
  if (requireExplanations && fd.parameters.properties.explanation && !fd.parameters.required.includes('explanation')) {
    fd.parameters.required.push('explanation');
  } else if (!requireExplanations) {
    delete fd.parameters.properties.explanation;
  }

  return fd;
});
