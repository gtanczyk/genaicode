import { CODEGEN_TRIGGER } from './prompt-consts.ts';
import { verbosePrompt, askQuestion } from '../cli/cli-params.ts';
import { verifySystemPromptLimit } from './limits.ts';
import { rcConfig } from '../main/config.ts';

/** Generates a system prompt */
export function getSystemPrompt(): string {
  console.log('Generate system prompt');

  let systemPrompt = `
  You are a code generation assistant. I want you to help me generate code for my ideas in my application source code.

  You can generate new code, or modify the existing one. You will receive instructions on what is the goal of requested code modification.

  Instructions will be passed to you either directly via message, with a file, or using the ${CODEGEN_TRIGGER} comment in the code.

  You should parse my application source code and then suggest changes using appropriate tools.

  The root directory of my application is \`${rcConfig.rootDir}\` and you should limit the changes only to this path.

  When suggesting changes always use absolute file paths.
  `;

  if (askQuestion) {
    systemPrompt +=
      '\nYou have the ability to ask the user a question at the beginning of the conversation if you need more information or clarification. ' +
      'Use this feature wisely to gather any crucial information that would help you better understand the task or provide more accurate code generation. ' +
      "To ask a question, use the 'askQuestion' function.";
  }

  if (verbosePrompt) {
    console.log('System prompt:');
    console.log(systemPrompt);
  }

  verifySystemPromptLimit(systemPrompt);

  return systemPrompt;
}
