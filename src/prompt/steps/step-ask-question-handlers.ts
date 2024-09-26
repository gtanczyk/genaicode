import { PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { askUserForConfirmation, askUserForInput } from '../../main/common/user-actions.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getSourceFiles, refreshFiles } from '../../files/find-files.js';
import {
  AskQuestionCall,
  AssistantItem,
  UserItem,
  ActionResult,
  ActionHandlerProps,
} from './step-ask-question-types.js';

export async function handleCancelCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    stepResult: StepResult.BREAK,
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
    userItem: { type: 'user', text: 'Code generation cancelled.' },
  };
}

export async function handleConfirmCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant is ready to start code generation. Do you want to proceed?',
    true,
  );
  if (userConfirmation) {
    putSystemMessage('Proceeding with code generation.');
    return {
      breakLoop: true,
      stepResult: StepResult.CONTINUE,
      assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
      userItem: { type: 'user', text: 'Confirmed. Proceed with code generation.' },
    };
  } else {
    putSystemMessage('Declined. Continuing the conversation.');
    return {
      breakLoop: false,
      stepResult: StepResult.CONTINUE,
      assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
      userItem: {
        type: 'user',
        text: 'Declined. Please continue the conversation.',
        functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
      },
    };
  }
}

export async function handleStartCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Proceeding with code generation.');
  return {
    breakLoop: true,
    stepResult: StepResult.CONTINUE,
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
    userItem: { type: 'user', text: 'Proceeding with code generation.' },
  };
}

export async function handleRequestFilesContent({
  askQuestionCall,
  messages,
}: ActionHandlerProps): Promise<ActionResult> {
  const requestedFiles = askQuestionCall.args?.requestFilesContent ?? [];
  // the request may be caused be an appearance of a new file, soe lets refresh
  refreshFiles();

  const { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  const assistantItem: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.content ?? '',
    functionCalls: [askQuestionCall],
  };
  const userItem: UserItem = {
    type: 'user',
    text: '',
    functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
  };

  if (legitimateFiles.length > 0) {
    handleLegitimateFiles(legitimateFiles, assistantItem, userItem, askQuestionCall, messages);
  }

  userItem.text =
    illegitimateFiles.length > 0
      ? 'Some files are not legitimate and their content cannot be provided'
      : 'All requested file contents have been provided automatically.';

  return { breakLoop: false, stepResult: StepResult.CONTINUE, assistantItem, userItem };
}

export async function handleRequestPermissions({
  askQuestionCall,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant is requesting additional permissions. Do you want to grant them?',
    false,
  );

  const userItem: UserItem = {
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
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
    userItem,
  };
}

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
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
    userItem: {
      type: 'user',
      text: userText,
      functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
    },
  };
}

export async function handleRequestAnswer({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const userText = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
    userItem: {
      type: 'user',
      text: userText,
      functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
    },
  };
}

export async function handleDefaultAction({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    assistantItem: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
    userItem: {
      type: 'user',
      text: "I don't want to start the code generation yet, let's talk a bit more.",
      functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
    },
  };
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

function handleLegitimateFiles(
  legitimateFiles: string[],
  assistantItem: AssistantItem,
  userItem: UserItem,
  askQuestionCall: AskQuestionCall,
  messages: { contextSourceCode: (paths: string[], pathsOnly: boolean) => string },
) {
  putSystemMessage('Automatically providing content for legitimate files', legitimateFiles);
  assistantItem.functionCalls.push({
    name: 'getSourceCode',
    args: { filePaths: legitimateFiles },
    id: askQuestionCall.id ? `${askQuestionCall.id}_src` : undefined,
  });

  userItem.functionResponses?.push({
    name: 'getSourceCode',
    content: messages.contextSourceCode(legitimateFiles, true),
    call_id: askQuestionCall.id ? `${askQuestionCall.id}_src` : '',
  });
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

function removeFileContentsFromPrompt(prompt: PromptItem[], filesToRemove: string[]) {
  prompt.forEach((item) => {
    if (item.type === 'user' && item.functionResponses) {
      item.functionResponses = item.functionResponses.map((response) => {
        if (response.name === 'getSourceCode' && response.content) {
          const contentObj = JSON.parse(response.content);
          filesToRemove.forEach((file) => {
            if (contentObj[file]) {
              delete contentObj[file].content;
            }
          });
          response.content = JSON.stringify(contentObj);
        }
        return response;
      });
    }
  });
}

function isFilePathLegitimate(filePath: string): boolean {
  return getSourceFiles().includes(filePath);
}
