import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ActionHandlerProps, ActionResult, RequestPermissionsArgs, UserItem } from '../step-ask-question-types.js';

export async function handleRequestPermissions({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  const [requestPermissionsCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can request the permissions.',
      },
    ],
    getFunctionDefs(),
    'requestPermissions',
    0.7,
    ModelType.CHEAP,
    options,
  )) as [FunctionCall<RequestPermissionsArgs> | undefined];

  if (!requestPermissionsCall) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  const userConfirmation = await askUserForConfirmation(
    'The assistant is requesting additional permissions. Do you want to grant them?',
    false,
    options,
  );

  const user: UserItem = {
    type: 'user',
    text: userConfirmation ? 'Permissions granted.' : 'Permission request denied.',
    functionResponses: [
      {
        name: 'requestPermissions',
        call_id: requestPermissionsCall.id,
        content: JSON.stringify({ confirmed: userConfirmation.confirmed }),
      },
    ],
  };

  if (userConfirmation.confirmed) {
    updatePermissions(requestPermissionsCall, options);
  }

  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: askQuestionCall.args?.message ?? '',
          functionCalls: [requestPermissionsCall],
        },
        user,
      },
    ],
  };
}

function updatePermissions(requestPermissionsCall: FunctionCall<RequestPermissionsArgs>, options: CodegenOptions) {
  const permissions = requestPermissionsCall.args;
  if (permissions) {
    if ('enableImagen' in permissions && permissions.enableImagen) {
      options.imagen = options.aiService === 'openai' ? 'dall-e' : 'vertex-ai';
    }
    if ('enableVision' in permissions && permissions.enableVision) options.vision = true;
    if ('allowDirectoryCreate' in permissions && permissions.allowDirectoryCreate) options.allowDirectoryCreate = true;
    if ('allowFileCreate' in permissions && permissions.allowFileCreate) options.allowFileCreate = true;
    if ('allowFileDelete' in permissions && permissions.allowFileDelete) options.allowFileDelete = true;
    if ('allowFileMove' in permissions && permissions.allowFileMove) options.allowFileMove = true;
  }
}
