import { FunctionCall, PromptItem } from '../../../../ai-service/common.js';
import { getSourceCodeTree, parseSourceCodeTree } from '../../../../files/source-code-tree.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ActionHandlerProps, ActionResult, RemoveFilesFromContextArgs } from '../step-ask-question-types.js';

export async function handleRemoveFilesFromContext({
  askQuestionMessage,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const [removeFilesFromContextCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionMessage ?? '',
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
    items: [
      {
        assistant: {
          type: 'assistant',
          text: askQuestionMessage ?? '',
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
  // Find all source code responses in the prompt history
  const sourceCodeResponses = prompt.filter(
    (item) => item.type === 'user' && item.functionResponses?.some((fr) => fr.name === 'getSourceCode'),
  );

  if (sourceCodeResponses.length === 0) {
    console.warn('No source code responses found in prompt history');
    return;
  }

  sourceCodeResponses.forEach((response) => {
    const sourceCodeResponse = response.functionResponses?.find((fr) => fr.name === 'getSourceCode');

    if (!sourceCodeResponse || !sourceCodeResponse.content) {
      console.warn('Skipping invalid source code response');
      return;
    }

    try {
      const contentObj = parseSourceCodeTree(JSON.parse(sourceCodeResponse.content));

      let modifiedFiles = 0;
      filesToRemove.forEach((file) => {
        if (contentObj[file] && 'content' in contentObj[file]) {
          contentObj[file].content = null;
          modifiedFiles++;
        }
      });

      // Only update if files were actually modified
      if (modifiedFiles > 0) {
        sourceCodeResponse.content = JSON.stringify(getSourceCodeTree(contentObj));
        console.log(`Removed content from ${modifiedFiles} files in source code response`);
      }
    } catch (error) {
      console.error('Error processing source code response:', error);
    }
  });
}
