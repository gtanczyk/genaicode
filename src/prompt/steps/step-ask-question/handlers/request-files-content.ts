import { FunctionCall, GenerateContentFunction, PromptItem } from '../../../../ai-service/common.js';
import { getSourceFiles, refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { getSourceCodeTree } from '../../../../files/source-code-tree.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
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
          sourceCodeTree[dirPath] && sourceCodeTree[dirPath][fileName] && 'content' in sourceCodeTree[dirPath][fileName]
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
    false,
  );

  if (!requestFilesContentCall) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  let requestedFiles = requestFilesContentCall.args?.filePaths ?? [];

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
      false,
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
      illegitimateFiles.length > 0
        ? `Some files are not legitimate and their content cannot be provided:\n\n${illegitimateFiles.join('\n')}`
        : alreadyProvidedFiles.length > 0
          ? `Some files were already provided in the conversation history:\n${alreadyProvidedFiles.join('\n')}\n\nProviding content for the remaining files.`
          : 'All requested file contents have been provided.',
    functionResponses: [
      {
        name: 'requestFilesContent',
        call_id: requestFilesContentCall.id,
        content: JSON.stringify({ filePaths: requestedFiles }),
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
  cheap: boolean,
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
    cheap,
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
