import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { executor as executeUpdateFile } from '../../../../operations/update-file/update-file-executor.js';
import { UpdateFileArgs as UpdateFileDefArgs } from '../../../../operations/update-file/update-file-def.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { generateRequestFilesContentCall } from './handle-request-files-content.js';
import { executeStepEnsureContext } from '../../step-ensure-context.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

registerActionHandler('updateFile', handleUpdateFile);

export async function handleUpdateFile({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('File update requested.', askQuestionCall);

  // First confirmation: Ask user if they want to proceed with content generation
  const generateConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant suggests generating new content for the file update. Do you want to proceed with content generation?',
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
        text: 'Canceling file update.' + (generateConfirmation.answer ? ` ${generateConfirmation.answer}` : ''),
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }

  putSystemMessage('Content generation started.');

  // Ensure file content is available in the context
  const requestedFilesCall = await generateRequestFilesContentCall(
    generateContentFn,
    prompt,
    askQuestionCall,
    options,
    ModelType.CHEAP,
  );

  if (requestedFilesCall) {
    await executeStepEnsureContext(prompt, requestedFilesCall, options);
  }

  const [updateFileCall] = (
    await generateContentFn(
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args?.message ?? '',
        },
        {
          type: 'user',
          text:
            'Ok, please provide the update using `updateFile` function. Please remember to use absolute file path.' +
            (generateConfirmation.answer ? ` ${generateConfirmation.answer}` : ''),
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'updateFile',
        temperature: options.temperature ?? 0.7,
        modelType: ModelType.DEFAULT,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    )
  )
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<UpdateFileDefArgs> | undefined];

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
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'The file does not exist or is empty or its content is not present in the context.',
      },
    );
    return {
      breakLoop: false,
      items: [],
    };
  }

  putSystemMessage(`The assistant has generated new content for file ${filePath}.`, {
    name: updateFileCall.name,
    args: {
      ...updateFileCall.args,
      oldContent: file.content,
    },
  });

  // Second confirmation: Ask user if they want to proceed with file update
  const applyConfirmation = await askUserForConfirmationWithAnswer(
    'The assistant has generated the new file content. Do you want to update the file?',
    'Update file',
    'Cancel update',
    false,
    options,
  );

  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args!.message,
    functionCalls: [updateFileCall],
  });

  if (applyConfirmation.answer) {
    putUserMessage(applyConfirmation.answer);
  }

  if (!applyConfirmation.confirmed) {
    putSystemMessage('File update rejected.');
    prompt.push({
      type: 'user',
      text: 'Rejecting file update.' + (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : ''),
      functionResponses: [
        {
          name: 'updateFile',
          call_id: updateFileCall.id,
          content: '',
        },
      ],
    });

    return {
      breakLoop: false,
      items: [],
    };
  }

  try {
    putSystemMessage('Applying file update');
    await executeUpdateFile(updateFileCall.args);
    refreshFiles();
    prompt.push({
      type: 'user',
      text: 'Accepting file update.' + (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : ''),
      functionResponses: [
        {
          name: 'updateFile',
          call_id: updateFileCall.id,
          content: '',
        },
      ],
    });
    return {
      breakLoop: false,
      items: [],
    };
  } catch {
    putSystemMessage('File update failed.');
    prompt.push({
      type: 'user',
      text:
        'Accepting file update.' +
        (applyConfirmation.answer ? ` ${applyConfirmation.answer}` : '') +
        ' Unfortunately, the file update failed, the new content was not saved.',
      functionResponses: [
        {
          name: 'updateFile',
          call_id: updateFileCall.id,
          content: '',
        },
      ],
    });
    return {
      breakLoop: false,
      items: [],
    };
  }
}
