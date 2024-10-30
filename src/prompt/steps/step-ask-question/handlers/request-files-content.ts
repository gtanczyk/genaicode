import { getSourceFiles, refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult, AssistantItem, UserItem } from '../step-ask-question-types.js';

export async function handleRequestFilesContent({
  askQuestionCall,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const requestedFiles = askQuestionCall.args?.requestFilesContent ?? [];
  // the request may be caused be an appearance of a new file, so lets refresh
  refreshFiles();

  const { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  const sourceCallId = (askQuestionCall.id ?? askQuestionCall.name) + '_source';
  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.content ?? '',
    functionCalls: [askQuestionCall, { name: 'getSourceCode', id: sourceCallId, args: { filePaths: legitimateFiles } }],
  };

  const sourceCode = getSourceCode({ filterPaths: legitimateFiles, forceAll: true }, options);
  const user: UserItem = {
    type: 'user',
    text:
      illegitimateFiles.length > 0
        ? 'Some files are not legitimate and their content cannot be provided'
        : 'All requested file contents have been provided.',
    functionResponses: [
      { name: 'askQuestion', call_id: askQuestionCall.id, content: undefined },
      {
        name: 'getSourceCode',
        call_id: sourceCallId,
        content: JSON.stringify(sourceCode),
      },
    ],
    cache: true,
  };

  return { breakLoop: false, stepResult: StepResult.CONTINUE, items: [{ assistant, user }] };
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
