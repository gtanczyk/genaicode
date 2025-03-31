import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { ActionHandlerProps, ActionResult, RemoveFilesFromContextArgs } from '../step-ask-question-types.js';

registerActionHandler('removeFilesFromContext', handleRemoveFilesFromContext);

export async function handleRemoveFilesFromContext({
  askQuestionCall,
  generateContentFn,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const [removeFilesFromContextCall] = (
    await generateContentFn(
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
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'removeFilesFromContext',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
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
    .map((item) => item.functionCall) as [FunctionCall<RemoveFilesFromContextArgs> | undefined];

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
    putSystemMessage('No specific files were provided for context reduction. The context remains unchanged.');
    userText = 'No specific files were provided for context reduction. The context remains unchanged.';
  }

  prompt.push(
    {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
      functionCalls: [removeFilesFromContextCall],
    },
    {
      type: 'user',
      text: userText,
      functionResponses: [
        { name: 'removeFilesFromContext', call_id: removeFilesFromContextCall.id, content: undefined },
      ],
    },
  );

  return {
    breakLoop: false,
    items: [],
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
      const contentObj = JSON.parse(sourceCodeResponse.content);

      let modifiedFiles = 0;
      filesToRemove.forEach((file) => {
        if (contentObj[file] && 'content' in contentObj[file]) {
          contentObj[file].content = null;
          modifiedFiles++;
        } else if (contentObj[file] && 'fragments' in contentObj[file]) {
          delete contentObj[file].fragments;
          modifiedFiles++;
        }
      });

      // Only update if files were actually modified
      if (modifiedFiles > 0) {
        sourceCodeResponse.content = JSON.stringify(contentObj);
        console.log(`Removed content from ${modifiedFiles} files in source code response`);
      }
    } catch (error) {
      console.error('Error processing source code response:', error);
    }
  });
}
