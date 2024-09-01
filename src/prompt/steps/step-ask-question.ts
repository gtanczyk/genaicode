import { input } from '@inquirer/prompts';
import { FunctionCall, FunctionDef, PromptItem } from '../../ai-service/common.js';
import { StepResult } from './steps-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';

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
          stopCodegen: boolean;
          shouldPrompt: boolean;
          requestFilesContent?: string[];
          requestPermissions: Record<
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

      if (askQuestionCall.args?.stopCodegen) {
        console.log('Assistant requested to stop code generation. Exiting...');
        return StepResult.BREAK;
      } else if (!askQuestionCall.args?.shouldPrompt) {
        console.log('Proceeding with code generation.');
        break;
      }

      const fileContentRequested = askQuestionCall.args?.requestFilesContent?.length! > 0;
      const permissionsRequested = Object.entries(askQuestionCall.args?.requestPermissions ?? {}).length > 0;
      const userAnswer = askQuestionCall.args?.shouldPrompt
        ? fileContentRequested
          ? 'Providing requested files content.'
          : permissionsRequested
            ? 'Permissions granted.'
            : await input({ message: 'Your answer' })
        : "Let's proceed with code generation.";

      if (permissionsRequested) {
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
              content: fileContentRequested
                ? messages.contextSourceCode(askQuestionCall.args?.requestFilesContent!)
                : undefined,
            },
          ],
        },
      );
      console.log('The question was answered');
    } else {
      console.log('Assistant did not ask a question. Proceeding with code generation.');
      break;
    }
  }

  return StepResult.CONTINUE;
}
