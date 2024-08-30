import { createInterface } from 'readline';
import { FunctionCall, FunctionDef, PromptItem } from '../../ai-service/common.js';
import { askQuestion } from '../../cli/cli-params.js';
import { StepResult } from './steps-types.js';

export async function executeStepAskQuestion(
  generateContentFn: (
    prompt: PromptItem[],
    functionDefs: FunctionDef[],
    requiredFunctionName: string,
    temperature: number,
    cheap: boolean,
  ) => Promise<FunctionCall[]>,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  messages: {
    contextSourceCode: (paths: string[]) => string;
  },
): Promise<StepResult> {
  if (!askQuestion) {
    console.log('Ask question is disabled by the --disable-ask-question flag.');
    return StepResult.CONTINUE;
  }

  console.log('Allowing the assistant to ask a question...');
  const questionAsked = false;
  while (!questionAsked) {
    const askQuestionResult = await generateContentFn(prompt, functionDefs, 'askQuestion', temperature, cheap);
    const askQuestionCall = askQuestionResult.find((call) => call.name === 'askQuestion');
    if (askQuestionCall) {
      console.log('Assistant asks:', askQuestionCall.args);

      if (askQuestionCall.args?.stopCodegen) {
        console.log('Assistant requested to stop code generation. Exiting...');
        return StepResult.BREAK;
      } else if (!askQuestionCall.args?.shouldPrompt) {
        console.log('Proceeding with code generation.');
        break;
      }

      const fileContentRequested =
        // @ts-expect-error FunctionCall is not parametrized
        askQuestionCall.args?.requestFileContent?.contextPaths && askQuestionCall.args?.requestFileContent?.execute;
      const userAnswer = askQuestionCall.args?.shouldPrompt
        ? fileContentRequested
          ? 'Providing requested files content'
          : await getUserInput('Your answer: ')
        : "Let's proceed with code generation.";
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
                ? messages.contextSourceCode(
                    // @ts-expect-error FunctionCall is not parametrized
                    askQuestionCall.args?.requestFileContent?.contextPaths,
                  )
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

async function getUserInput(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
