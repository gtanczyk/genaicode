import { GenerateFunctionCallsArgs, GenerateFunctionCallsFunction } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getExpandedContextPaths } from '../../../../files/source-code-utils.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import {
  ActionHandlerProps,
  ActionResult,
  AskQuestionCall,
  AssistantItem,
  RequestFilesContentArgs,
  UserItem,
} from '../step-ask-question-types.js';
import { isFileContentAlreadyProvided, categorizeLegitimateFiles } from './file-request-utils.js';

registerActionHandler('requestFilesContent', handleRequestFilesContent);

export async function handleRequestFilesContent({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  let requestFilesContentCall = await generateRequestFilesContentCall(
    generateContentFn,
    prompt,
    askQuestionCall,
    options,
    ModelType.CHEAP,
  );

  if (!requestFilesContentCall) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  let requestedFiles = getExpandedContextPaths(requestFilesContentCall.args?.filePaths ?? [], options);

  putSystemMessage('Requesting files content', {
    requestedFiles,
    expandedRequestedFiles: requestedFiles.filter((file) => !requestFilesContentCall?.args?.filePaths?.includes(file)),
  });

  // Check which files are already provided in the conversation history
  const alreadyProvidedFiles = requestedFiles.filter((file) => isFileContentAlreadyProvided(file, prompt));

  if (alreadyProvidedFiles.length === requestedFiles.length) {
    putSystemMessage('All requested files are already provided');
    // All requested files are already provided
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
        functionCalls: [requestFilesContentCall],
      },
      {
        type: 'user',
        text: 'The requested file contents are already provided in the conversation history.',
        functionResponses: [
          {
            name: 'requestFilesContent',
            call_id: requestFilesContentCall.id,
            content: JSON.stringify({ filePaths: requestedFiles }),
          },
        ],
        cache: true,
      },
    );

    return { breakLoop: false, items: [] };
  }

  // Filter out already provided files
  requestedFiles = requestedFiles.filter((file) => !isFileContentAlreadyProvided(file, prompt));

  // the request may be caused be an appearance of a new file, so lets refresh
  refreshFiles();

  let { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  if (illegitimateFiles.length > 0) {
    requestFilesContentCall = await generateRequestFilesContentCall(
      generateContentFn,
      prompt,
      askQuestionCall,
      options,
      // use non cheap mode, as maybe the cheap mode didn't provide correct files
      ModelType.DEFAULT,
    );

    if (!requestFilesContentCall) {
      return {
        breakLoop: true,
        items: [],
      };
    }

    requestedFiles = requestFilesContentCall.args?.filePaths ?? [];
    const categorized = categorizeLegitimateFiles(requestedFiles);
    legitimateFiles = categorized.legitimateFiles;
    illegitimateFiles = categorized.illegitimateFiles;
  }

  const sourceCallId = (askQuestionCall.id ?? askQuestionCall.name) + '_source';
  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: [
      requestFilesContentCall,
      { name: 'getSourceCode', id: sourceCallId, args: { filePaths: legitimateFiles } },
    ],
  };

  const sourceCode = getSourceCode(
    { filterPaths: legitimateFiles, forceAll: true, ignoreImportantFiles: true },
    options,
  );
  const user: UserItem = {
    type: 'user',
    text:
      (alreadyProvidedFiles.length > 0
        ? // TODO: Maybe reference to some specific getSourceCode call id
          `Some files were already provided in the conversation history:
${alreadyProvidedFiles.map((path) => `- ${path}`).join('\n')}

Providing content for the remaining files:
${requestedFiles.map((path) => `- ${path}`).join('\n')}`
        : `All requested file contents have been provided:
${legitimateFiles.map((path) => `- ${path}`).join('\n')}`) +
      (illegitimateFiles.length > 0
        ? `\n\nSome files are not legitimate and their content cannot be provided:
${illegitimateFiles.map((path) => `- ${path}`).join('\n')}`
        : ''),
    data: { legitimateFiles, illegitimateFiles },
    functionResponses: [
      {
        name: 'requestFilesContent',
        call_id: requestFilesContentCall.id,
        content: JSON.stringify({ filePaths: legitimateFiles }),
      },
      {
        name: 'getSourceCode',
        call_id: sourceCallId,
        content: JSON.stringify(sourceCode),
      },
    ],
    cache: true,
  };

  putSystemMessage('Providing files content', {
    requestedFiles,
    legitimateFiles,
    illegitimateFiles,
  });

  prompt.push(assistant, user);

  return { breakLoop: false, items: [] };
}

export async function generateRequestFilesContentCall(
  generateContentFn: GenerateFunctionCallsFunction,
  prompt: PromptItem[],
  askQuestionCall: AskQuestionCall,
  options: CodegenOptions,
  modelType: ModelType,
) {
  const req = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can request the files contents.',
      },
    ],
    getFunctionDefs(),
    'requestFilesContent',
    0.7,
    modelType,
    options,
  ] as GenerateFunctionCallsArgs;
  const [requestFilesContentCall] = (await generateContentFn(...req)) as [
    FunctionCall<RequestFilesContentArgs> | undefined,
  ];

  return requestFilesContentCall;
}
