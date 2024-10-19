import { CodegenOptions } from '../../../../main/codegen-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult, AskQuestionCall, UserItem } from '../step-ask-question-types.js';

export async function handleRequestPermissions({
  askQuestionCall,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant is requesting additional permissions. Do you want to grant them?',
    false,
  );

  const user: UserItem = {
    type: 'user',
    text: userConfirmation ? 'Permissions granted.' : 'Permission request denied.',
    functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
  };

  if (userConfirmation) {
    updatePermissions(askQuestionCall, options);
  }

  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user,
      },
    ],
  };
}

function updatePermissions(askQuestionCall: AskQuestionCall, options: CodegenOptions) {
  if (
    askQuestionCall.args &&
    typeof askQuestionCall.args === 'object' &&
    'requestPermissions' in askQuestionCall.args
  ) {
    const permissions = askQuestionCall.args.requestPermissions;
    if (permissions && typeof permissions === 'object') {
      if ('enableImagen' in permissions && permissions.enableImagen) {
        options.imagen = options.aiService === 'chat-gpt' ? 'dall-e' : 'vertex-ai';
      }
      if ('enableVision' in permissions && permissions.enableVision) options.vision = true;
      if ('allowDirectoryCreate' in permissions && permissions.allowDirectoryCreate)
        options.allowDirectoryCreate = true;
      if ('allowFileCreate' in permissions && permissions.allowFileCreate) options.allowFileCreate = true;
      if ('allowFileDelete' in permissions && permissions.allowFileDelete) options.allowFileDelete = true;
      if ('allowFileMove' in permissions && permissions.allowFileMove) options.allowFileMove = true;
    }
  }
}
