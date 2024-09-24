import { FunctionCall, FunctionDef, PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { askUserForConfirmation, askUserForInput } from '../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../main/common/content-bus.js';
import { abortController } from '../../main/interactive/codegen-worker.js';
import path from 'path';
import { rcConfig } from '../../main/config.js';
import { getSourceFiles } from '../../files/find-files.js';

export async function executeStepAskQuestion(
  generateContentFn: (
    prompt: PromptItem[],
    functionDefs: FunctionDef[],
    requiredFunctionName: string,
    temperature: number,
    cheap: boolean,
    options: CodegenOptions,
  ) => Promise<FunctionCall[]>,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  messages: {
    contextSourceCode: (paths: string[], pathsOnly: boolean) => string;
  },
  options: CodegenOptions,
): Promise<StepResult> {
  console.log('Allowing the assistant to ask a question...');
  const questionAsked = false;
  while (!questionAsked) {
    const askQuestionResult = await generateContentFn(prompt, functionDefs, 'askQuestion', temperature, cheap, options);
    const askQuestionCall = askQuestionResult.find((call) => call.name === 'askQuestion') as
      | FunctionCall<{
          actionType:
            | 'requestAnswer'
            | 'requestPermissions'
            | 'requestFilesContent'
            | 'removeFilesFromContext'
            | 'confirmCodeGeneration'
            | 'startCodeGeneration'
            | 'cancelCodeGeneration';
          content: string;
          requestFilesContent?: string[];
          requestPermissions?: Record<
            | 'allowDirectoryCreate'
            | 'allowFileCreate'
            | 'allowFileDelete'
            | 'allowFileMove'
            | 'enableVision'
            | 'enableImagen',
            boolean
          >;
          removeFilesFromContext?: string[];
        }>
      | undefined;

    if (askQuestionCall) {
      console.log('Assistant asks:', askQuestionCall.args);
      if (askQuestionCall.args?.content) {
        putAssistantMessage(askQuestionCall.args?.content, askQuestionCall.args);
      }

      const actionType = askQuestionCall.args?.actionType;

      if (actionType === 'cancelCodeGeneration') {
        putSystemMessage('Assistant requested to stop code generation. Exiting...');
        return StepResult.BREAK;
      } else if (actionType === 'confirmCodeGeneration') {
        const userConfirmation = await askUserForConfirmation(
          'The assistant is ready to start code generation. Do you want to proceed?',
          true,
        );
        if (userConfirmation) {
          putSystemMessage('Proceeding with code generation.');
          break;
        } else {
          putSystemMessage('Code generation cancelled by user. Continuing the conversation.');
        }
      } else if (actionType === 'startCodeGeneration') {
        putSystemMessage('Proceeding with code generation.');
        break;
      }

      const fileContentRequested =
        actionType === 'requestFilesContent' && (askQuestionCall.args?.requestFilesContent?.length ?? 0) > 0;
      const permissionsRequested =
        actionType === 'requestPermissions' &&
        Object.entries(askQuestionCall.args?.requestPermissions ?? {}).filter(([, enabled]) => enabled).length > 0;
      const contextReductionRequested =
        actionType === 'removeFilesFromContext' && (askQuestionCall.args?.removeFilesFromContext?.length ?? 0) > 0;

      const assistantItem = { type: 'assistant' as const, functionCalls: [askQuestionCall] as FunctionCall[] };
      const userItem = {
        type: 'user' as const,
        text: '',
        functionResponses: [
          {
            name: 'askQuestion',
            call_id: askQuestionCall.id,
            content: undefined as string | undefined,
          },
        ],
      };

      if (fileContentRequested) {
        const requestedFiles = askQuestionCall.args?.requestFilesContent ?? [];
        const legitimateFiles: string[] = [];
        const illegitimateFiles: string[] = [];

        requestedFiles.forEach((filePath) => {
          const absolutePath = path.resolve(rcConfig.rootDir, filePath);
          if (isFilePathLegitimate(absolutePath)) {
            legitimateFiles.push(absolutePath);
          } else {
            illegitimateFiles.push(filePath);
          }
        });

        if (legitimateFiles.length > 0) {
          putSystemMessage('Automatically providing content for legitimate files', legitimateFiles);
          assistantItem.functionCalls.push({
            name: 'getSourceCode',
            args: { filePaths: legitimateFiles },
            id: askQuestionCall.id + '_src',
          });

          userItem.functionResponses.push({
            name: 'getSourceCode',
            content: messages.contextSourceCode(legitimateFiles, true),
            call_id: askQuestionCall.id + '_src',
          });
        }

        if (illegitimateFiles.length > 0) {
          userItem.text = `The following files are not legitimate and their content cannot be provided: ${illegitimateFiles.join(', ')}`;
        } else {
          userItem.text = 'All requested file contents have been provided automatically.';
        }
      } else if (permissionsRequested) {
        userItem.text = (await askUserForConfirmation(
          'The assistant is requesting additional permissions. Do you want to grant them?',
          false,
        ))
          ? 'Permissions granted.'
          : 'Permission request denied.';
      } else if (contextReductionRequested) {
        const filesToRemove = askQuestionCall.args?.removeFilesFromContext ?? [];
        if (filesToRemove.length > 0) {
          // Remove file contents from the prompt
          prompt.forEach((item) => {
            if (item.type === 'user' && item.functionResponses) {
              item.functionResponses = item.functionResponses.filter((response) => {
                if (response.name === 'getSourceCode' && response.content) {
                  const contentObj = JSON.parse(response.content);
                  filesToRemove.forEach((file) => {
                    if (contentObj[file]) {
                      delete contentObj[file].content;
                    }
                  });
                  response.content = JSON.stringify(contentObj);
                }
                return true;
              });
            }
          });
          userItem.text = `Context reduction applied. Removed content for files: ${filesToRemove.join(', ')}`;
        } else {
          userItem.text = 'No specific files were provided for context reduction. The context remains unchanged.';
        }
      } else if (actionType === 'requestAnswer') {
        userItem.text = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');
      } else {
        userItem.text = "I don't want to start the code generation yet, let's talk a bit more.";
      }

      putUserMessage(userItem.text);

      if (
        permissionsRequested &&
        askQuestionCall.args?.requestPermissions &&
        userItem.text === 'Permissions granted.'
      ) {
        if (askQuestionCall.args?.requestPermissions.enableImagen) {
          options.imagen = options.aiService === 'chat-gpt' ? 'dall-e' : 'vertex-ai';
        }
        if (askQuestionCall.args?.requestPermissions.enableVision) {
          options.vision = true;
        }
        if (askQuestionCall.args?.requestPermissions.allowDirectoryCreate) {
          options.allowDirectoryCreate = true;
        }
        if (askQuestionCall.args?.requestPermissions.allowFileCreate) {
          options.allowFileCreate = true;
        }
        if (askQuestionCall.args?.requestPermissions.allowFileDelete) {
          options.allowFileDelete = true;
        }
        if (askQuestionCall.args?.requestPermissions.allowFileMove) {
          options.allowFileMove = true;
        }
      }

      prompt.push(assistantItem, userItem);

      console.log('The question was answered');

      if (abortController?.signal.aborted) {
        return StepResult.BREAK;
      }
    } else {
      console.log('Assistant did not ask a question. Proceeding with code generation.');
      break;
    }
  }

  return StepResult.CONTINUE;
}

function isFilePathLegitimate(filePath: string): boolean {
  return getSourceFiles().includes(filePath);
}
