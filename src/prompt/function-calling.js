import { requireExplanations, temperature, cheap, vision } from '../cli/cli-params.js';

/**
 * Function definitions for function calling feature
 */
export const functionDefs = [
  {
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
              'Proposed update of a file. The update is an object which contains properties like file path, update tool name, and few other important properties.',
            properties: {
              path: { type: 'string', description: 'An absolute path of the project file that will be updated' },
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
            required: ['path', 'updateToolName', ...(vision ? ['contextImageAssets'] : [])],
          },
        },
        explanation: {
          type: 'string',
          description: 'Explanation of planned changes or explanation of reasoning for no code changes',
        },
      },
      required: ['fileUpdates', 'contextPaths'],
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
          description: 'Path of the file that will be created, it must not be empty.',
        },
        newContent: {
          type: 'string',
          description: 'Content of the file that will be created, it must no be empty.',
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
        contextImagePath: {
          type: 'string',
          description:
            'Path to a image file that will be used as a context for image generation. It is useful if there is a need to edit an image with genAI.',
        },
        size: {
          type: 'object',
          properties: {
            width: {
              type: 'number',
              description: 'width of the image',
            },
            height: {
              type: 'number',
              description: 'height of the image',
            },
          },
          required: ['width', 'height'],
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
  {
    name: 'imglyRemoveBackground',
    description: 'Removes background from an image using @imgly/background-removal-node',
    parameters: {
      type: 'object',
      properties: {
        inputFilePath: {
          type: 'string',
          description: 'The file path of the input image.',
        },
        outputFilePath: {
          type: 'string',
          description: 'The file path to save the output image with removed background.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind removing the background from this image',
        },
      },
      required: ['inputFilePath', 'outputFilePath'],
    },
  },
  {
    name: 'resizeImage',
    description: 'Resize image to the desired size',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The file path of the image.',
        },
        size: {
          type: 'object',
          properties: {
            width: {
              type: 'number',
              description: 'width of the image',
            },
            height: {
              type: 'number',
              description: 'height of the image',
            },
          },
          required: ['width', 'height'],
          description: 'The size of the image to generate.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind removing the background from this image',
        },
      },
      required: ['filePath', 'size'],
    },
  },
  {
    name: 'splitImage',
    description: 'Split an image into multiple parts and save them as separate files.',
    parameters: {
      type: 'object',
      properties: {
        inputFilePath: {
          type: 'string',
          description: 'The file path of the input image to be split.',
        },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rect: {
                type: 'object',
                properties: {
                  x: { type: 'number', description: 'The x-coordinate of the top-left corner of the rectangle.' },
                  y: { type: 'number', description: 'The y-coordinate of the top-left corner of the rectangle.' },
                  width: { type: 'number', description: 'The width of the rectangle.' },
                  height: { type: 'number', description: 'The height of the rectangle.' },
                },
                required: ['x', 'y', 'width', 'height'],
              },
              outputFilePath: {
                type: 'string',
                description: 'The file path to save the extracted part of the image.',
              },
            },
            required: ['rect', 'outputFilePath'],
          },
          description: 'An array of parts to extract from the image, each with a rectangle and output file path.',
        },
        explanation: {
          type: 'string',
          description: 'The explanation of the reasoning behind splitting this image',
        },
      },
      required: ['inputFilePath', 'parts'],
    },
  },
  {
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
      },
      required: ['content', 'shouldPrompt', 'promptNecessity'],
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
