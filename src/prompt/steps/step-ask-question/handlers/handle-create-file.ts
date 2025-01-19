import { ActionHandler, ActionResult } from '../step-ask-question-types.js';
import { executor as executeCreateFile } from '../../../../operations/create-file/create-file-executor.js';
import { CreateFileArgs } from '../../../../operations/create-file/create-file-def.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { refreshFiles } from '../../../../files/find-files.js';

export const handleCreateFile: ActionHandler = async ({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}): Promise<ActionResult> => {
  putSystemMessage('File creation requested, new content generation started.', askQuestionCall);

  const [createFileCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Ok, please provide the file creation using `createFile` function. Please remember to use absolute file path.',
      },
    ],
    getFunctionDefs(),
    'createFile',
    options.temperature ?? 0.7,
    false,
    options,
  )) as [FunctionCall<CreateFileArgs> | undefined];

  if (!createFileCall || !createFileCall.args) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  const { filePath } = createFileCall.args;

  const file = getSourceCode({ filterPaths: [filePath], forceAll: true }, options)[filePath];

  if (file && 'content' in file && file.content) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args!.message,
          },
          user: {
            type: 'user',
            text: 'The file already exists. Please use updateFile function to modify existing files.',
          },
        },
      ],
    };
  }

  putSystemMessage(`The assistant suggests creating a new file ${filePath}.`, {
    name: createFileCall.name,
    args: createFileCall.args,
  });

  const userConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant suggests creating a new file. Do you want to proceed?',
    'Accept file creation',
    'Reject file creation',
    false,
  );

  if (!userConfirmation.confirmed) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args!.message,
            functionCalls: [createFileCall],
          },
          user: {
            type: 'user',
            text: 'Rejecting file creation.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
            functionResponses: [
              {
                name: 'createFile',
                call_id: createFileCall.id,
                content: '',
              },
            ],
          },
        },
      ],
    };
  } else {
    try {
      await executeCreateFile(createFileCall.args, options);
      refreshFiles();
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args!.message,
              functionCalls: [createFileCall],
            },
            user: {
              type: 'user',
              text: 'Accepting file creation.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
              functionResponses: [
                {
                  name: 'createFile',
                  call_id: createFileCall.id,
                  content: '',
                },
              ],
            },
          },
        ],
      };
    } catch (error) {
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args!.message,
              functionCalls: [createFileCall],
            },
            user: {
              type: 'user',
              text:
                'Accepting file creation.' +
                (userConfirmation.answer ? ` ${userConfirmation.answer}` : '') +
                ' Unfortunately, the file creation failed: ' +
                (error instanceof Error ? error.message : 'unknown error'),
              functionResponses: [
                {
                  name: 'createFile',
                  call_id: createFileCall.id,
                  content: '',
                },
              ],
            },
          },
        ],
      };
    }
  }
};