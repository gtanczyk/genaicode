import { PromptItem } from '../../../ai-service/common.js';
import { StepResult } from '../steps-types.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { askUserForConfirmation, askUserForInput } from '../../../main/common/user-actions.js';
import { putSystemMessage } from '../../../main/common/content-bus.js';
import { getSourceFiles, refreshFiles } from '../../../files/find-files.js';
import {
  AskQuestionCall,
  AssistantItem,
  UserItem,
  ActionResult,
  ActionHandlerProps,
} from './step-ask-question-types.js';
import { executeStepContextOptimization } from '../step-context-optimization.js';
import { getSourceCodeResponse } from '../steps-utils.js';
import { getSourceCode } from '../../../files/read-files.js';

export async function handleCancelCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Assistant requested to stop code generation. Exiting...');
  return {
    breakLoop: true,
    stepResult: StepResult.BREAK,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
        user: { type: 'user', text: 'Code generation cancelled.' },
      },
    ],
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
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
          user: { type: 'user', text: 'Confirmed. Proceed with code generation.' },
        },
      ],
    };
  } else {
    putSystemMessage('Declined. Continuing the conversation.');
    return {
      breakLoop: false,
      stepResult: StepResult.CONTINUE,
      items: [
        {
          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
          user: {
            type: 'user',
            text: 'Declined. Please continue the conversation.',
            functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
          },
        },
      ],
    };
  }
}

export async function handleStartCodeGeneration({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  putSystemMessage('Proceeding with code generation.');
  return {
    breakLoop: true,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },
        user: { type: 'user', text: 'Proceeding with code generation.' },
      },
    ],
  };
}

export async function handleRequestFilesContent({
  askQuestionCall,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const requestedFiles = askQuestionCall.args?.requestFilesContent ?? [];
  // the request may be caused be an appearance of a new file, so lets refresh
  refreshFiles();

  const { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  const sourceCallId = (askQuestionCall.id ?? '') + '_source';
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
      { name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined },
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

export async function handleContextOptimization({
  askQuestionCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  const userConfirmation = await askUserForConfirmation(
    'The assistant suggests optimizing the context to reduce token usage, cost, and latency. Do you want to proceed?',
    false,
  );

  const user: UserItem = {
    type: 'user',
    text: userConfirmation ? 'Context optimization applied.' : 'Context optimization not applied.',
    functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
  };

  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.content ?? '',
    functionCalls: [askQuestionCall],
  };

  if (userConfirmation) {
    // the request may be caused be an appearance of a new file, so lets refresh
    refreshFiles();

    // Execute context optimization step
    putSystemMessage('Executing context optimization step.');
    await executeStepContextOptimization(generateContentFn, [...prompt, assistant, user], options);
  }

  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant,
        user,
      },
    ],
  };
}

export async function handleRequestAnswer({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  const userText = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');
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

export async function handleDefaultAction({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
        user: {
          type: 'user',
          text: "I don't want to start the code generation yet, let's talk a bit more.",
          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
        },
      },
    ],
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

function isFilePathLegitimate(filePath: string): boolean {
  return getSourceFiles().includes(filePath);
}
