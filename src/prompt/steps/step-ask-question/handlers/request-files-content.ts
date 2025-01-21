import { GenerateContentFunction } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getSourceFiles, refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getSourceCodeTree } from '../../../../files/source-code-tree.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  ActionHandlerProps,
  ActionResult,
  AskQuestionCall,
  AssistantItem,
  RequestFilesContentArgs,
  UserItem,
} from '../step-ask-question-types.js';

/**
 * Checks if a file's content is already provided in the conversation history
 * @param filePath The path of the file to check
 * @param prompt The conversation history
 * @returns true if the file content is already available in the history
 */
function isFileContentAlreadyProvided(filePath: string, prompt: PromptItem[]): boolean {
  return prompt.some((item) => {
    if (item.type !== 'user' || !item.functionResponses) {
      return false;
    }

    return item.functionResponses.some((response) => {
      if (response.name !== 'getSourceCode' || !response.content) {
        return false;
      }

      try {
        const sourceCodeTree = JSON.parse(response.content);
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);

        return (
          sourceCodeTree[dirPath] &&
          sourceCodeTree[dirPath][fileName] &&
          'content' in sourceCodeTree[dirPath][fileName] &&
          sourceCodeTree[dirPath][fileName].content !== null
        );
      } catch (error) {
        console.warn('Error parsing getSourceCode response:', error);
        return false;
      }
    });
  });
}

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

  let requestedFiles = requestFilesContentCall.args?.filePaths ?? [];

  putSystemMessage('Requesting files content', requestFilesContentCall.args);

  // Check which files are already provided in the conversation history
  const alreadyProvidedFiles = requestedFiles.filter((file) => isFileContentAlreadyProvided(file, prompt));

  if (alreadyProvidedFiles.length === requestedFiles.length) {
    // All requested files are already provided
    const assistant: AssistantItem = {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
      functionCalls: [requestFilesContentCall],
    };

    const user: UserItem = {
      type: 'user',
      text: 'The requested file contents are already provided in the conversation history.',
      data: { requestedFiles },
      functionResponses: [
        {
          name: 'requestFilesContent',
          call_id: requestFilesContentCall.id,
          content: JSON.stringify({ filePaths: requestedFiles }),
        },
      ],
      cache: true,
    };

    return { breakLoop: false, items: [{ assistant, user }] };
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

  const sourceCode = getSourceCodeTree(
    getSourceCode({ filterPaths: legitimateFiles, forceAll: true, ignoreImportantFiles: true }, options),
  );
  const user: UserItem = {
    type: 'user',
    text:
      (alreadyProvidedFiles.length > 0
        ? `Some files were already provided in the conversation history:
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

  return { breakLoop: false, items: [{ assistant, user }] };
}

async function generateRequestFilesContentCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  askQuestionCall: AskQuestionCall,
  options: CodegenOptions,
  modelType: ModelType,
) {
  const [requestFilesContentCall] = (await generateContentFn(
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
  )) as [FunctionCall<RequestFilesContentArgs> | undefined];

  return requestFilesContentCall;
}

function categorizeLegitimateFiles(requestedFiles: string[]): {
  legitimateFiles: string[];
  illegitimateFiles: string[];
} {
  const legitimateFiles: string[] = [];
  const illegitimateFiles: string[] = [];

  requestedFiles.forEach((filePath) => {
    if (isFilePathLegitimate(filePath)) {
      legitimateFiles.push(filePath);
    } else {
      illegitimateFiles.push(filePath);
    }
  });

  return { legitimateFiles, illegitimateFiles };
}

function isFilePathLegitimate(filePath: string): boolean {
  return getSourceFiles().includes(filePath);
}
