import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { executor as executeCreateFile } from '../../../../operations/create-file/create-file-executor.js';
import { CreateFileArgs } from '../../../../operations/create-file/create-file-def.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

registerActionHandler('createFile', handleCreateFile);

export async function handleCreateFile({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('File creation requested.', askQuestionCall);

  // First confirmation: Ask user if they want to proceed with content generation
  const generateConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant suggests generating content for a new file. Do you want to proceed with content generation?',
    'Generate content',
    'Cancel content generation',
    false,
    options,
  );

  if (generateConfirmation.answer) {
    putUserMessage(generateConfirmation.answer);
  }

  if (!generateConfirmation.confirmed) {
    putSystemMessage('Content generation canceled.');

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Canceling file creation.' + (generateConfirmation.answer ? ` ${generateConfirmation.answer}` : ''),
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }

  putSystemMessage('Content generation started.');

  const [createFileCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text:
          'Ok, please provide the file creation using `createFile` function. Please remember to use absolute file path.' +
          (generateConfirmation.answer ? ` ${generateConfirmation.answer}` : ''),
      },
    ],
    getFunctionDefs(),
    'createFile',
    options.temperature ?? 0.7,
    ModelType.DEFAULT,
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

  putSystemMessage(`The assistant has generated content for new file ${filePath}.`, {
    name: createFileCall.name,
    args: createFileCall.args,
  });

  // Second confirmation: Ask user if they want to proceed with file creation
  const applyConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant has generated the file content. Do you want to create the file?',
    'Create file',
    'Cancel file creation',
    false,
    options,
  );

  if (!applyConfirmation.confirmed) {
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
            text: 'Rejecting file creation.' + (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : ''),
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
            text: 'Accepting file creation.' + (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : ''),
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
              (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : '') +
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
