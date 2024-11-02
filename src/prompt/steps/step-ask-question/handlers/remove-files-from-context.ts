import { FunctionCall, PromptItem } from '../../../../ai-service/common.js';
import { getSourceCodeTree, parseSourceCodeTree } from '../../../../files/source-code-tree.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { StepResult } from '../../steps-types.js';
import { getSourceCodeResponse } from '../../steps-utils.js';
import { ActionHandlerProps, ActionResult, RemoveFilesFromContextArgs } from '../step-ask-question-types.js';

export async function handleRemoveFilesFromContext({
  askQuestionCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const [removeFilesFromContextCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can request the removal of files from context.',
      },
    ],
    getFunctionDefs(),
    'removeFilesFromContext',
    0.7,
    true,
    options,
  )) as [FunctionCall<RemoveFilesFromContextArgs> | undefined];

  if (!removeFilesFromContextCall) {
    return {
      breakLoop: true,
      stepResult: StepResult.BREAK,
      items: [],
    };
  }

  const filesToRemove = removeFilesFromContextCall.args?.filePaths ?? [];
  let userText = '';

  if (filesToRemove.length > 0) {
    removeFileContentsFromPrompt(prompt, filesToRemove);
    putSystemMessage('Context reduction applied', filesToRemove);
    userText = 'Context reduction applied';
  } else {
    userText = 'No specific files were provided for context reduction. The context remains unchanged.';
  }

  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: askQuestionCall.args?.message ?? '',
          functionCalls: [removeFilesFromContextCall],
        },
        user: {
          type: 'user',
          text: userText,
          functionResponses: [
            { name: 'removeFilesFromContext', call_id: removeFilesFromContextCall.id, content: undefined },
          ],
        },
      },
    ],
  };
}

function removeFileContentsFromPrompt(prompt: PromptItem[], filesToRemove: string[]) {
  const response = getSourceCodeResponse(prompt);
  if (!response || !response.content) {
    throw new Error('Could not find source code response');
  }
  const contentObj = parseSourceCodeTree(JSON.parse(response.content));
  filesToRemove.forEach((file) => {
    if (contentObj[file] && 'content' in contentObj[file]) {
      contentObj[file].content = null;
    }
  });
  response.content = JSON.stringify(getSourceCodeTree(contentObj));
}
