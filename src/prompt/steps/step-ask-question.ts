import { FunctionCall, FunctionDef, PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { askUserForConfirmation, askUserForInput } from '../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../main/common/content-bus.js';

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
    contextSourceCode: (paths: string[]) => string;
  },
  options: CodegenOptions,
): Promise<StepResult> {
  console.log('Allowing the assistant to ask a question...');
  const questionAsked = false;
  while (!questionAsked) {
    const askQuestionResult = await generateContentFn(prompt, functionDefs, 'askQuestion', temperature, cheap, options);
    const askQuestionCall = askQuestionResult.find((call) => call.name === 'askQuestion') as
      | FunctionCall<{
          content: string;
          stopCodegen: boolean;
          shouldPrompt: boolean;
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
        }>
      | undefined;
    if (askQuestionCall) {
      console.log('Assistant asks:', askQuestionCall.args);
      if (askQuestionCall.args?.content) {
        putAssistantMessage(askQuestionCall.args?.content);
      }

      if (askQuestionCall.args?.stopCodegen) {
        putSystemMessage('Assistant requested to stop code generation. Exiting...');
        return StepResult.BREAK;
      } else if (!askQuestionCall.args?.shouldPrompt) {
        putSystemMessage('Proceeding with code generation.');
        break;
      }

      const fileContentRequested = (askQuestionCall.args?.requestFilesContent?.length ?? 0) > 0;
      const permissionsRequested =
        Object.entries(askQuestionCall.args?.requestPermissions ?? {}).filter(([, enabled]) => enabled).length > 0;
      const userAnswer = askQuestionCall.args?.shouldPrompt
        ? fileContentRequested
          ? (await askUserForConfirmation(
              'The assistant is requesting file contents. Do you want to provide them?',
              true,
            ))
            ? 'Providing requested files content.'
            : 'Request for file contents denied.'
          : permissionsRequested
            ? (await askUserForConfirmation(
                'The assistant is requesting additional permissions. Do you want to grant them?',
                false,
              ))
              ? 'Permissions granted.'
              : 'Permission request denied.'
            : await askUserForInput('Your answer', askQuestionCall.args?.content)
        : "Let's proceed with code generation.";

      putUserMessage(userAnswer);

      if (permissionsRequested && askQuestionCall.args?.requestPermissions && userAnswer === 'Permissions granted.') {
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

      prompt.push(
        { type: 'assistant', functionCalls: [askQuestionCall] },
        {
          type: 'user',
          text: userAnswer,
          functionResponses: [
            {
              name: 'askQuestion',
              call_id: askQuestionCall.id,
              content:
                fileContentRequested && userAnswer === 'Providing requested files content.'
                  ? messages.contextSourceCode(askQuestionCall.args!.requestFilesContent!)
                  : undefined,
            },
          ],
        },
      );
      console.log('The question was answered', userAnswer);
    } else {
      console.log('Assistant did not ask a question. Proceeding with code generation.');
      break;
    }
  }

  return StepResult.CONTINUE;
}
