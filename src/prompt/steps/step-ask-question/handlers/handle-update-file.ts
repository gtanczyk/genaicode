import { ActionHandler, ActionResult } from '../step-ask-question-types.js';
import { executor as executeUpdateFile } from '../../../../operations/update-file/update-file-executor.js';
import { UpdateFileArgs as UpdateFileDefArgs } from '../../../../operations/update-file/update-file-def.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { refreshFiles } from '../../../../files/find-files.js';

export const handleUpdateFile: ActionHandler = async ({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}): Promise<ActionResult> => {
  putSystemMessage('File update requested, new content generation started.', askQuestionCall);

  const [updateFileCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Ok, please provide the update using `updateFile` function. Please remember to use absolute file path.',
      },
    ],
    getFunctionDefs(),
    'updateFile',
    options.temperature ?? 0.7,
    false,
    options,
  )) as [FunctionCall<UpdateFileDefArgs> | undefined];

  if (!updateFileCall || !updateFileCall.args) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  const { filePath } = updateFileCall.args;

  const file = getSourceCode({ filterPaths: [filePath], forceAll: true }, options)[filePath];

  if (!file || !('content' in file) || !file.content) {
    // TODO: In this corner case we should probably retry the operation but prefix it with getSourceCode

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
            text: 'The file does not exist or is empty or its content is not present in the context.',
          },
        },
      ],
    };
  }

  putSystemMessage(`The assistant suggests updating the file ${filePath}.`, {
    name: updateFileCall.name,
    args: {
      ...updateFileCall.args,
      oldContent: file.content,
    },
  });

  const userConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant suggests updating the file. Do you want to proceed?',
    'Accept file update',
    'Reject file update',
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
            functionCalls: [updateFileCall],
          },
          user: {
            type: 'user',
            text: 'Rejecting file update.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
            functionResponses: [
              {
                name: 'updateFile',
                call_id: updateFileCall.id,
                content: '',
              },
            ],
          },
        },
      ],
    };
  } else {
    try {
      await executeUpdateFile(updateFileCall.args);
      refreshFiles();
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args!.message,
              functionCalls: [updateFileCall],
            },
            user: {
              type: 'user',
              text: 'Accepting file update.' + (userConfirmation.answer ? ` ${userConfirmation.answer}` : ''),
              functionResponses: [
                {
                  name: 'updateFile',
                  call_id: updateFileCall.id,
                  content: '',
                },
              ],
            },
          },
        ],
      };
    } catch {
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args!.message,
              functionCalls: [updateFileCall],
            },
            user: {
              type: 'user',
              text:
                'Accepting file update.' +
                (userConfirmation.answer ? ` ${userConfirmation.answer}` : '') +
                ' Unfortunately, the file update failed, the new content was not saved.',
              functionResponses: [
                {
                  name: 'updateFile',
                  call_id: updateFileCall.id,
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
