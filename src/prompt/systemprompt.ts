import { CODEGEN_TRIGGER } from './prompt-consts.js';
import { verbosePrompt, askQuestion } from '../cli/cli-params.js';
import { verifySystemPromptLimit } from './limits.js';
import { rcConfig } from '../main/config.js';

/** Generates a system prompt */
export function getSystemPrompt(): string {
  console.log('Generate system prompt');

  let systemPrompt = `
  You are a code generation assistant. I want you to help me generate code for my ideas in my application source code.

  You can generate new code, or modify the existing one. You will receive instructions on what is the goal of requested code modification.

  Instructions will be passed to you either directly via message, with a file, or using the ${CODEGEN_TRIGGER} comment in the code.

  You should parse my application source code and then suggest changes using appropriate tools.

  The root directory of my application is \`${rcConfig.rootDir}\` and you should limit the changes only to this path.

  Additional suggestions, or corners cases to think about:
  - When suggesting changes always use absolute file paths.
  - Always aim to return working code
  - Do not leave out commented out fragments like "// ... (keep other existing functions)"
  - For large files prefer to use \`patchFile\` function
  - Suggest user to split large files if it makes sense for current task
  - At the start of conversation the user will express what you are allowed to do (for example: create files, move files, generate images etc.). At the start of conversation you should ensure you have necessary allowances for the current task.
  - Consider failing the task with explanation if instructions are not clear enough, or something feels completely wrong.
  - Do not produce unnecessary code, ensure the code you generate will be used once all changes are done.

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
