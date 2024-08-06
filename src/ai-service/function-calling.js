import { requireExplanations, temperature, cheap } from '../cli/cli-params.js';

/**
 * Function definitions for function calling feature
 */
export const functionDefs = [
  {
    name: 'getSourceCode',
    description:
      'This function returns source code of the application in Map format, where absolute file path is the key, and file content is the value. This function can be called only once during the conversation, and only if suggested by the user.',
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
  },
  {
    name: 'getImageAssets',
    description:
      'This function returns a map of application image assets. This map contains absolute file path, and basic metadata information. It does not contain contents. Contents must be requested using dedicated tool.',
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
  },
  {
    name: 'codegenSummary',
    description:
      'This function is called with a summary of proposed updates. It contains a list of file paths that will be subject to code generation request, and also a list of file paths that make sense to use as a context for code generation requests.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'An array of proposed file updates.',
          items: {
            type: 'object',
            description: 'Proposed update of a file, the path, and the method of update',
            properties: {
              path: { type: 'string', description: 'An absolute path of the project file that will be updated' },
              updateToolName: {
                type: 'string',
                enum: [
                  'updateFile',
                  'patchFile',
                  'createFile',
                  'deleteFile',
                  'createDirectory',
                  'moveFile',
                  'generateImage',
                  'downloadFile',
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
                  'A list of of absolute image asset paths that should be included to the context of LLm request',
                items: { type: 'string' },
              },
            },
            required: ['path', 'updateToolName', 'temperature', 'prompt', 'contextImageAssets', 'cheap'],
          },
        },
        contextPaths: {
          type: 'array',
          description:
            'An array of absolute paths of files that should be used to provide context for the following updates. Context files could be for example the dependencies, or files that depend on one of the files that we want to update in the next step.',
          items: {
            type: 'string',
          },
        },
        explanation: {
          type: 'string',
          description: 'Explanation of planned changes or explanation of reasoning for no code changes',
        },
      },
      required: ['files', 'contextPaths', 'explanation'],
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
    name: 'patchFile',
    description:
      'Partially update a file content. The file must already exists in the application source code. The function should be called only if there is a need to actually change something.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to patch.',
        },
        patch: {
          type: 'string',
          description: `Modification to the file expressed in patch format. Example patch:

\`\`\`
Index: filename.js
===================================================================
--- filename.js
+++ filename.js
@@ -1,2 +1,3 @@
 line1
+line3
 line2
\\ No newline at end of file
\`\`\`
          `,
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
      'Create a new file with specified content. The file will be created inside of project folder structure. This tool should not be used of creation if image files.',
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
  {
    name: 'generateImage',
    description: 'Generate an image using AI service and save it as a file.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'The prompt that will be used to generate the image. This prompt must be detailed, it will be used by image generation model.',
        },
        filePath: {
          type: 'string',
          description: 'The file path to save the generated image.',
        },
        size: {
          type: 'string',
          enum: ['256x256', '512x512', '1024x1024'],
          description: 'The size of the image to generate.',
        },
        cheap: {
          type: 'boolean',
          description:
            'true value means that the prompt will be executed with cheaper model, which work faster, but provides lower quality results, so please use it only in situation when lower quality results are acceptable for the prompt.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind generating this image',
        },
      },
      required: ['prompt', 'filePath', 'size', 'cheap'],
    },
  },
  {
    name: 'downloadFile',
    description: 'Download file from url, and save to file',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path to save the downloaded file.',
        },
        downloadUrl: {
          type: 'string',
          description: 'The url of the file that will be used for downloading.',
        },
        explanation: {
          type: 'string',
          description: 'The reasoning behind downloading this image.',
        },
      },
      required: ['filePath', 'downloadUrl'],
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
