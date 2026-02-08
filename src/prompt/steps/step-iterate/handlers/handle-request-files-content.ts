import { GenerateContentFunction, GenerateContentArgs } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getExpandedContextPaths } from '../../../../files/source-code-utils.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import {
  ActionHandlerProps,
  ActionResult,
  IterateCall,
  AssistantItem,
  RequestFilesContentArgs,
  UserItem,
} from '../step-iterate-types.js';
import { isFileContentAlreadyProvided, categorizeLegitimateFiles } from './file-request-utils.js';

registerActionHandler('requestFilesContent', handleRequestFilesContent);

export async function handleRequestFilesContent({
  iterateCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  let requestFilesContentCall = await generateRequestFilesContentCall(
    generateContentFn,
    prompt,
    iterateCall,
    options,
    ModelType.CHEAP,
  );

  if (!requestFilesContentCall) {
    return {
      breakLoop: false,
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
        text: iterateCall.args?.message ?? '',
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
      iterateCall,
      options,
      // use non cheap mode, as maybe the cheap mode didn't provide correct files
      ModelType.DEFAULT,
    );

    if (!requestFilesContentCall) {
      return {
        breakLoop: false,
        items: [],
      };
    }

    requestedFiles = requestFilesContentCall.args?.filePaths ?? [];
    const categorized = categorizeLegitimateFiles(requestedFiles);
    legitimateFiles = categorized.legitimateFiles;
    illegitimateFiles = categorized.illegitimateFiles;
  }

  const sourceCallId = (iterateCall.id ?? iterateCall.name) + '_source';
  const assistant: AssistantItem = {
    type: 'assistant',
    text: iterateCall.args?.message ?? '',
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
        : '') +
      '\n\nPlease consider removing files that are no longer needed from the context using `removeFilesFromContext`.',
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
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  iterateCall: IterateCall,
  options: CodegenOptions,
  modelType: ModelType,
) {
  const req: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can request the files contents.',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'requestFilesContent',
      temperature: 0.7,
      modelType,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];
  const [requestFilesContentCall] = (await generateContentFn(...req))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [FunctionCall<RequestFilesContentArgs> | undefined];

  return requestFilesContentCall;
}
