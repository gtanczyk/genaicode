import { PromptItem } from '../../../../ai-service/common.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';
import { getSourceCodeResponse } from '../../steps-utils.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';

export async function handleRemoveFilesFromContext({
  askQuestionCall,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> {
  const filesToRemove = askQuestionCall.args?.removeFilesFromContext ?? [];
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
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user: {
          type: 'user',
          text: userText,
          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
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
  const contentObj = JSON.parse(response.content);
  filesToRemove.forEach((file) => {
    if (contentObj[file]) {
      delete contentObj[file].content;
    }
  });
  response.content = JSON.stringify(contentObj);
}
